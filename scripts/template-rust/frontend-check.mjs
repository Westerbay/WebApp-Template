import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { generateTemplate } from "../template-generator.mjs"
import "./check-assets.mjs"

const root = resolve(import.meta.dirname, "../..")
const output = join(
  root,
  "output",
  `rust-generated-frontend-${randomUUID().slice(0, 8)}`
)
await mkdir(output, { recursive: true })
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status})`)
}
for (const profile of ["en", "fr", "multilingual"]) {
  const directory = join(output, profile)
  console.log(`Validating generated Rust project: ${profile}`)
  await generateTemplate({ output: directory, profile, backend: "rust" })
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], directory)
  run(process.execPath, ["scripts/rust/frontend-check.mjs"], directory)
}
console.log(`Generated Rust frontend evidence: ${output}`)
