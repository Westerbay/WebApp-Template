import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"

const root = resolve(import.meta.dirname, "../..")
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"))

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "template-dev-startup-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, packageManager: manifest.packageManager })
  )
  await writeFile(
    join(directory, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\n"
  )
  await writeFile(
    join(directory, "turbo.json"),
    await readFile(join(root, "turbo.json"))
  )
  for (const [name, packageName] of [
    ["web", "web"],
    ["api", "@workspace/api"],
    ["i18n", "@workspace/i18n"],
    ["database", "@workspace/database"],
    ["email", "@workspace/email"],
  ]) {
    const path = join(directory, "packages", name)
    await mkdir(path, { recursive: true })
    await writeFile(
      join(path, "package.json"),
      JSON.stringify({
        name: packageName,
        scripts: {
          dev: "node dev.mjs",
          ...(name === "i18n" ? { build: "node build.mjs" } : {}),
        },
      })
    )
    await writeFile(
      join(path, "dev.mjs"),
      `import { readFileSync, writeFileSync } from "node:fs"
${["web", "api", "i18n"].includes(name) ? 'readFileSync("../../translations-ready")' : ""}
writeFileSync("../../${name}-started", "ready")
`
    )
  }
  await writeFile(
    join(directory, "packages/i18n/build.mjs"),
    `import { writeFileSync } from "node:fs"
await new Promise(resolve => setTimeout(resolve, 150))
writeFileSync("../../translations-ready", "ready")
`
  )
  const run = () =>
    spawnSync(
      process.execPath,
      [
        join(root, "node_modules/turbo/bin/turbo"),
        "dev",
        "--filter=web",
        "--filter=@workspace/api",
        "--ui=stream",
      ],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
      }
    )
  return { directory, run }
}

test("dev generates translations before starting their consumers and watcher", async (t) => {
  const { directory, run } = await fixture(t)
  const result = run()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  for (const name of ["web", "api", "i18n"])
    await access(join(directory, `${name}-started`))
})

test("failed translation generation prevents consumers and watcher from starting", async (t) => {
  const { directory, run } = await fixture(t)
  await writeFile(
    join(directory, "packages/i18n/build.mjs"),
    "process.exit(12)\n"
  )
  const result = run()
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  for (const name of ["web", "api", "i18n"])
    await assert.rejects(access(join(directory, `${name}-started`)), {
      code: "ENOENT",
    })
})
