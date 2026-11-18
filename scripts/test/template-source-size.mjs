import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile, symlink, unlink, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const source = resolve(import.meta.dirname, "../..")

export async function verifyGeneratedSourceSize(project) {
  const manifest = JSON.parse(
    await readFile(resolve(project, "package.json"), "utf8")
  )
  assert.equal(
    manifest.scripts["size:check"],
    "node scripts/quality/source-size.mjs"
  )
  assert.match(manifest.scripts["project:check"], /pnpm size:check/)
  assert.match(
    manifest.scripts["tooling:test"],
    /scripts\/test\/source-size\.test\.mjs/
  )
  const modules = resolve(project, "node_modules")
  const oversized = resolve(project, "source-size-regression.ts")
  // Reuse installed tooling only while exercising this extracted archive's actual CLI.
  await symlink(resolve(source, "node_modules"), modules, "dir")
  try {
    const result = execFileSync(
      process.execPath,
      ["scripts/quality/source-size.mjs"],
      {
        cwd: project,
        encoding: "utf8",
        stdio: "pipe",
      }
    )
    assert.match(result, /Source size: \d+ files checked, 0 errors/)
    await writeFile(oversized, "export const statement = 1\n".repeat(501))
    assert.throws(
      () =>
        execFileSync(process.execPath, ["scripts/quality/source-size.mjs"], {
          cwd: project,
          encoding: "utf8",
          stdio: "pipe",
        }),
      (error) =>
        error.status === 1 &&
        /source-size-regression\.ts: 501 source lines/.test(error.stderr)
    )
  } finally {
    await unlink(oversized).catch((error) => {
      if (error.code !== "ENOENT") throw error
    })
    await unlink(modules)
  }
}
