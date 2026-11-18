import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { countSourceLines } from "../quality/source-lines.mjs"
import {
  assessSourceSize,
  checkSourceSizes,
  isMaintainedSource,
} from "../quality/source-size.mjs"

test("counts TypeScript code and string content without blank lines or comments", () => {
  const source = [
    "// Heading",
    "/* A block",
    " * comment */",
    "",
    'const url = "https://example.test" // A trailing comment',
    "const value = `",
    "// This is template content",
    "/* This too */",
    "`",
    "const view = <div>",
    "  {/* JSX comment */}",
    "  // Visible JSX text",
    "</div>",
  ].join("\r\n")
  for (const path of ["example.tsx", "example.jsx"])
    assert.equal(countSourceLines(source, path), 9)
  for (const path of [
    "example.mts",
    "example.cts",
    "example.mjs",
    "example.cjs",
  ])
    assert.equal(
      countSourceLines("const text = `\n// template content\n`", path),
      3
    )
})

test("counts Rust raw strings and characters while excluding nested comments", () => {
  const source = [
    "//! Module documentation",
    "/* Outer /* nested */",
    " * comment */",
    'const RAW: &str = r##"',
    "// String content",
    '"# still raw',
    '"##;',
    "fn borrowed<'a>(value: &'a str) -> &'a str {",
    "    let slash = '/'; /* inline */",
    "    /* prefix */ value",
    "}",
  ].join("\n")
  assert.equal(countSourceLines(source, "example.rs"), 8)
})

test("counts code after multiline comments and CSS string content", () => {
  assert.equal(
    countSourceLines(
      '/* comment\n */ .item {\n content: "/* text */";\n}\n',
      "example.css"
    ),
    3
  )
  assert.equal(countSourceLines("// comment without newline", "example.rs"), 0)
})

test("CSS single-quoted strings and non-nesting comments cannot hide later code", () => {
  const source = [
    ".first { content: '/*'; }",
    ".second { content: '//'; }",
    "/* CSS /* comments do not nest */ .third { color: red; }",
    ".fourth { color: blue; }",
  ].join("\n")
  assert.equal(countSourceLines(source, "example.css"), 4)
})

test("warns above 300 and fails only above 500 source lines", () => {
  for (const [lines, expected] of [
    [300, null],
    [301, "warning"],
    [500, "warning"],
    [501, "error"],
  ]) {
    assert.equal(assessSourceSize("module.rs", lines).level, expected)
  }
})

test("exceptions remain bounded, explained and removable after refactoring", () => {
  const exception = {
    maxLines: 550,
    reason: "One cohesive protocol declaration",
  }
  assert.equal(assessSourceSize("module.rs", 550, exception).level, "warning")
  assert.equal(assessSourceSize("module.rs", 551, exception).level, "error")
  assert.throws(
    () => assessSourceSize("module.rs", 400, exception),
    /unnecessary/
  )
  assert.throws(
    () => assessSourceSize("module.rs", 520, { maxLines: 550 }),
    /reason/
  )
  assert.throws(
    () =>
      assessSourceSize("module.rs", 520, { ...exception, maxLines: Infinity }),
    /bounded/
  )
})

test("generated output is excluded while maintained declarations and tests remain checked", () => {
  for (const path of [
    "apps/web/src/lib/api/schema.d.ts",
    "apps/web/src/lib/api/responses.zod.ts",
    "apps/web/src/routeTree.gen.ts",
    "packages/i18n/src/generated/messages/index.js",
  ]) {
    assert.equal(isMaintainedSource(path), false, path)
  }
  for (const path of [
    "packages/ui/src/assets/assets.d.ts",
    "apps/api/src/main.rs",
    "apps/web/test/components/profiles/catalogue.spec.ts",
    "scripts/rust/journeys/browser.mjs",
    "apps/web/src/component.jsx",
    "scripts/module.mts",
    "scripts/module.cts",
  ]) {
    assert.equal(isMaintainedSource(path), true, path)
  }
})

test("checks untracked extractions, respects Git ignores and tolerates tracked deletions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "source-size-git-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  execFileSync("git", ["init", "--quiet"], { cwd: root })
  await writeFile(join(root, "deleted.rs"), "fn old() {}")
  execFileSync("git", ["add", "deleted.rs"], { cwd: root })
  await rm(join(root, "deleted.rs"))
  await writeFile(join(root, ".gitignore"), "ignored.ts\n")
  await writeFile(join(root, "ignored.ts"), "ignored\n".repeat(600))
  await writeFile(join(root, "new.ts"), "const statement = 1\n".repeat(501))
  await mkdir(join(root, "apps/web/src/lib/api"), { recursive: true })
  await writeFile(
    join(root, "apps/web/src/lib/api/schema.d.ts"),
    "generated\n".repeat(900)
  )
  const results = await checkSourceSizes(root)
  assert.equal(results.length, 1)
  assert.equal(results[0].path, "new.ts")
  assert.equal(results[0].level, "error")
})

test("extracted projects are checked without Git, even inside a parent checkout", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "template-source-size-archive-")
  )
  t.after(() => rm(directory, { recursive: true, force: true }))
  execFileSync("git", ["init", "--quiet"], { cwd: directory })
  const root = join(directory, "project")
  await mkdir(join(root, "apps/api/src"), { recursive: true })
  await writeFile(
    join(root, "apps/api/src/main.rs"),
    "fn statement() {}\n".repeat(501)
  )
  for (const excluded of ["node_modules", "dist", "target", "output"]) {
    await mkdir(join(root, excluded), { recursive: true })
    await writeFile(
      join(root, excluded, "large.ts"),
      "const statement = 1\n".repeat(900)
    )
  }
  const results = await checkSourceSizes(root)
  assert.deepEqual(
    results.map(({ path, lines, level }) => ({ path, lines, level })),
    [{ path: "apps/api/src/main.rs", lines: 501, level: "error" }]
  )
})
