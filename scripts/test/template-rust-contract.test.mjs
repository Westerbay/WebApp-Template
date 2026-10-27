import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { generateZod } from "../../template/backends/rust/scripts/rust/generate-zod.mjs"

const root = resolve(import.meta.dirname, "../..")

test("the Rust template validators match its OpenAPI source", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rust-zod-contract-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const target = join(directory, "responses.zod.ts")
  await generateZod(join(root, "apps/api-rust/openapi.json"), target)
  execFileSync(
    "pnpm",
    [
      "exec",
      "prettier",
      "--config",
      join(root, ".prettierrc"),
      "--write",
      target,
    ],
    { cwd: root }
  )
  assert.equal(
    await readFile(target, "utf8"),
    await readFile(
      join(root, "template/backends/rust/responses.zod.ts"),
      "utf8"
    ),
    "Rust validator drift; run pnpm api:generate:rust"
  )
})

test("invalid OpenAPI fails generation instead of reporting success", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rust-zod-invalid-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const input = join(directory, "invalid.json")
  const target = join(directory, "responses.zod.ts")
  await writeFile(input, "{ invalid JSON }")
  await assert.rejects(generateZod(input, target))
  await assert.rejects(access(target), { code: "ENOENT" })
})
