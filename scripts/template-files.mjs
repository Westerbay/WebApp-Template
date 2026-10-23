import { cp, lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, extname, relative, resolve } from "node:path"
import { execFileSync } from "node:child_process"

const excluded = [
  "template/",
  "apps/api-rust/",
  ".agents/",
  ".codex/",
  "scripts/template-",
  "scripts/test/template-",
  ".github/workflows/template",
  "packages/i18n/messages/",
]

export async function listTemplateFiles(source) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: source,
      encoding: "utf8",
    }
  )
    .split("\0")
    .filter(Boolean)
  const selected = []
  for (const file of files) {
    if (excluded.some((prefix) => file.startsWith(prefix))) continue
    if (
      file
        .split("/")
        .some((part) => part.startsWith(".env") && part !== ".env.example")
    )
      continue
    const path = resolveSourcePath(source, file)
    let entry
    try {
      entry = await lstat(path)
    } catch (error) {
      if (error.code === "ENOENT") continue
      throw error
    }
    if (!entry.isFile()) throw new Error(`Unsupported source entry: ${file}`)
    selected.push(file)
  }
  return selected
}

export async function copyTemplateFiles(source, destination, files) {
  await mkdir(dirname(destination), { recursive: true })
  await mkdir(destination, { recursive: false })
  for (const file of files) {
    const target = resolveSourcePath(destination, projectBackendPaths(file))
    await mkdir(dirname(target), { recursive: true })
    await cp(resolve(source, file), target)
    if (
      [".md", ".mjs", ".json", ".yaml", ".yml", ".ts", ".tsx", ".sh"].includes(
        extname(file)
      )
    ) {
      const content = await readFile(target, "utf8")
      const normalized = projectBackendPaths(content)
      if (normalized !== content) await writeFile(target, normalized)
    }
  }
}

// Source backends have explicit names; generated projects contain only apps/api.
export function projectBackendPaths(content) {
  return content.replaceAll("apps/api-nestjs", "apps/api")
}

function resolveSourcePath(root, path) {
  const target = resolve(root, path)
  const inside = relative(root, target)
  if (inside === ".." || inside.startsWith("../") || inside.startsWith("..\\"))
    throw new Error("Unsafe source path")
  return target
}
