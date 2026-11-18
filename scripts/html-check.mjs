import { spawnSync } from "node:child_process"
import { access, mkdir, mkdtemp, readdir } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const output = join(root, "output/html-check")
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, "run-"))
const web = join(directory, "web")
const email = join(directory, "email")
const portServer = createServer()
await new Promise((resolve, reject) => {
  portServer.once("error", reject)
  portServer.listen(0, "127.0.0.1", resolve)
})
const address = portServer.address()
if (!address || typeof address === "string") throw new Error("No local port")
await new Promise((resolve, reject) =>
  portServer.close((error) => (error ? reject(error) : resolve()))
)
const env = {
  ...process.env,
  CI: "1",
  HTML_CHECK_PORT: String(address.port),
  HTML_CHECK_DOCUMENTS: web,
  HTML_CHECK_EMAILS: email,
  HTML_CHECK_OUTPUT: join(directory, "browser"),
}
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${command} exited ${result.status ?? result.signal}`)
}
async function exists(path) {
  try {
    await access(join(root, path))
    return true
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
}
console.log(`HTML conformance evidence: ${directory}`)
const jar = join(root, "node_modules/vnu-jar/build/dist/vnu.jar")
run("java", ["-jar", jar, "--version"])
run("pnpm", ["--filter", "web^...", "build"])
const emailGroups = []
if (await exists("packages/email/package.json")) {
  env.HTML_CHECK_EMAILS = join(email, "nestjs")
  emailGroups.push(env.HTML_CHECK_EMAILS)
  run("pnpm", [
    "--filter",
    "@workspace/email",
    "exec",
    "vitest",
    "run",
    "test/unit/html-documents.test.ts",
  ])
}
const rust = (await exists("apps/api-rust/Cargo.toml"))
  ? "apps/api-rust"
  : (await exists("apps/api/Cargo.toml"))
    ? "apps/api"
    : undefined
if (rust) {
  env.HTML_CHECK_EMAILS = join(email, "rust")
  emailGroups.push(env.HTML_CHECK_EMAILS)
  run("cargo", [
    "test",
    "--locked",
    "--manifest-path",
    `${rust}/Cargo.toml`,
    "--lib",
    "html_documents",
  ])
}
run(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build", "--config", "vite.html.config.ts"],
  join(root, "apps/web")
)
run("pnpm", [
  "--filter",
  "web",
  "exec",
  "playwright",
  "test",
  "--config",
  "playwright.html.config.ts",
])
const documents = []
for (const group of [web, ...emailGroups]) {
  const files = (await readdir(group))
    .filter((file) => file.endsWith(".html"))
    .sort()
  if (!files.length) throw new Error(`No generated HTML in ${group}`)
  documents.push(...files.map((file) => join(group, file)))
}
if (await exists("apps/web/public")) {
  documents.push(
    ...(await readdir(join(root, "apps/web/public"), { recursive: true }))
      .filter((file) => file.endsWith(".html"))
      .map((file) => join(root, "apps/web/public", file))
  )
}
run("java", ["-jar", jar, "--html", "--errors-only", ...documents])
console.log(`Nu Html Checker passed: ${documents.length} documents`)
