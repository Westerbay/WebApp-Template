import { readdir, readFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesUnder(path)))
    else files.push(path)
  }
  return files
}

const failures = []
const rootManifest = JSON.parse(await readFile(resolve(root, "package.json")))
if (rootManifest.packageManager !== "pnpm@12.4.1") {
  failures.push("packageManager must remain pnpm@12.4.1")
}

const specializedComposeFiles = (await readdir(resolve(root, "infra/compose")))
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => `infra/compose/${file}`)
for (const composeFile of ["compose.yml", ...specializedComposeFiles]) {
  const content = await readFile(resolve(root, composeFile), "utf8")
  for (const match of content.matchAll(/^\s*image:\s*(\S+)/gm)) {
    if (!match[1]?.includes(":") || match[1].endsWith(":latest")) {
      failures.push(`unpinned image in ${composeFile}: ${match[1]}`)
    }
  }
}

const packageEntries = await readdir(resolve(root, "packages"), {
  withFileTypes: true,
})
const sourceDirectories = [
  resolve(root, "apps/api-nestjs/src"),
  resolve(root, "apps/web/src"),
  ...packageEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(root, "packages", entry.name, "src")),
]
const activeFiles = []
for (const directory of sourceDirectories) {
  try {
    activeFiles.push(...(await filesUnder(directory)))
  } catch {
    // A package may contain only configuration files.
  }
}
for (const file of activeFiles) {
  const content = await readFile(file, "utf8")
  if (/\b(?:Elysia|Eden|Bun)\b|["']elysia["']|@elysiajs/.test(content)) {
    failures.push(`retired technology reference: ${relative(root, file)}`)
  }
}

const routes = [
  "(auth)/email-verified.tsx",
  "(auth)/sign-in.tsx",
  "index.tsx",
  "(auth)/sign-up.tsx",
  "(auth)/forgot-password.tsx",
  "(auth)/reset-password.tsx",
  "(auth)/verify-email.tsx",
]
for (const route of routes) {
  const content = await readFile(
    resolve(root, "apps/web/src/routes", route),
    "utf8"
  )
  if (!content.includes("privateHead(")) {
    failures.push(`missing private metadata contract: ${route}`)
  }
}

const workflowFiles = [
  ...(await filesUnder(resolve(root, ".github/workflows"))),
  ...(await filesUnder(resolve(root, ".github/actions"))),
].filter((path) => /\.ya?ml$/.test(path))
const workflow = (
  await Promise.all(workflowFiles.map((path) => readFile(path, "utf8")))
).join("\n")
for (const match of workflow.matchAll(/uses:\s*([^\s#]+)/g)) {
  if (!match[1].startsWith("./") && !/@[a-f0-9]{40}$/.test(match[1])) {
    failures.push(`GitHub action is not pinned to a commit: ${match[1]}`)
  }
}

const workflowWithoutComments = workflow
  .replace(/^\s*#.*$/gm, "")
  .replace(/\s+#.*$/gm, "")
const gitleaksJob = workflowWithoutComments.match(
  /(?:^|\n)  gitleaks:\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\n|$)/
)?.[1]
if (!gitleaksJob) {
  failures.push("CI must keep an independent gitleaks job")
} else {
  const gitleaksRequirements = [
    [
      /fetch-depth:\s*0(?:\s|$)/,
      "Gitleaks checkout must fetch the complete Git history",
    ],
    [
      /GITLEAKS_VERSION:\s*["']?8\.30\.1["']?(?:\s|$)/,
      "Gitleaks must remain pinned to version 8.30.1",
    ],
    [
      /GITLEAKS_SHA256:\s*["']?551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb["']?(?:\s|$)/,
      "Gitleaks archive checksum must remain pinned",
    ],
    [
      /https:\/\/github\.com\/gitleaks\/gitleaks\/releases\/download\/v\$\{GITLEAKS_VERSION\}\/gitleaks_\$\{GITLEAKS_VERSION\}_linux_x64\.tar\.gz/,
      "Gitleaks Linux x64 archive must come from its official versioned release",
    ],
    [
      /GITLEAKS_SHA256[\s\S]{0,200}\|\s*sha256sum\s+(?:--check\s+--strict|--strict\s+--check)/,
      "Gitleaks archive checksum must be verified before extraction",
    ],
    [
      /gitleaks["']?\s+git\s+(?=[^\n]*--redact)(?=[^\n]*--verbose)[^\n]*\s\.\s*$/m,
      "Gitleaks must scan repository history",
    ],
  ]
  for (const [pattern, message] of gitleaksRequirements) {
    if (!pattern.test(gitleaksJob)) failures.push(message)
  }

  const checksumIndex = gitleaksJob.search(/sha256sum\s+/)
  const extractionIndex = gitleaksJob.search(/tar\s+--extract/)
  if (
    checksumIndex < 0 ||
    extractionIndex < 0 ||
    checksumIndex > extractionIndex
  ) {
    failures.push("Gitleaks archive must be verified before extraction")
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exitCode = 1
} else {
  console.log("Project metadata and infrastructure pins checked")
}
