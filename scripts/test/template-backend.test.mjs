import assert from "node:assert/strict"
import { access, mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { unzipSync } from "fflate"
import { check } from "prettier"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { generateTemplate } from "../template-generator.mjs"
import { createTemplateArchive } from "../template-archives.mjs"

test("rejects an unknown backend before creating a project", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "template-backend-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const output = join(directory, "project")
  await assert.rejects(
    generateTemplate({ output, backend: "unknown" }),
    /Unknown template backend/
  )
  await assert.rejects(access(output), { code: "ENOENT" })
})

for (const profile of ["en", "fr", "multilingual"]) {
  test(`Rust ${profile} archive is standalone and omits the Nest runtime`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "template-rust-archive-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const archive = await createTemplateArchive({
      output: directory,
      profile,
      backend: "rust",
    })
    assert.equal(
      archive,
      join(directory, `webapp-template-${profile}-rust.zip`)
    )
    const entries = unzipSync(await readFile(archive))
    const text = (path) => Buffer.from(entries[path]).toString("utf8")
    for (const required of [
      "apps/api/Cargo.toml",
      "apps/api/Cargo.lock",
      "apps/api/migrations/202610190001_initial.sql",
      "apps/api/Dockerfile",
      ".env.production.example",
      "apps/api/src/config/runtime.rs",
      "infra/compose/production.yml",
      "scripts/rust/frontend-check.mjs",
      "scripts/rust/check.sh",
      "scripts/rust/runtime-check.sh",
    ])
      assert.ok(entries[required], required)
    assert.deepEqual(
      Object.keys(entries).filter(
        (path) =>
          path.startsWith("apps/api/migrations/") && path.endsWith(".sql")
      ),
      ["apps/api/migrations/202610190001_initial.sql"]
    )
    for (const name of Object.keys(entries)) {
      assert.ok(
        !/^(?:template\/|packages\/(?:database|core|email)\/|scripts\/infra\/)/.test(
          name
        ),
        name
      )
      assert.ok(!/^apps\/api\/.*\.(?:ts|js)$/.test(name), name)
      assert.ok(!/^apps\/api-(?:nestjs|rust)\//.test(name), name)
      assert.ok(!name.startsWith("scripts/template-"), name)
      assert.ok(
        !name.includes("/node_modules/") && !name.includes("/target/"),
        name
      )
    }
    assert.ok(!text("pnpm-lock.yaml").includes("@nestjs/"))
    assert.ok(!text("pnpm-workspace.yaml").includes("@esbuild-kit/core-utils"))
    assert.ok(
      await check(text("pnpm-workspace.yaml"), {
        filepath: "pnpm-workspace.yaml",
      })
    )
    const root = JSON.parse(text("package.json"))
    assert.equal(root.scripts["db:studio"], undefined)
    assert.equal(root.scripts["test:integration"], "sh scripts/rust/check.sh")
    assert.match(text("scripts/rust/check.sh"), /\/\.\.\/\.\.\/apps\/api"/)
    assert.doesNotMatch(text("scripts/rust/check.sh"), /template-rust/)
    assert.match(
      text(".github/workflows/ci.yml"),
      /sh scripts\/rust\/runtime-check.sh/
    )
    assert.match(root.scripts["test:e2e"], /rust\/frontend-check/)
    assert.match(text("apps/api/Dockerfile"), /USER 10001:10001/)
    assert.match(text("compose.yml"), /name: webapp-template-rust/)
    assert.match(text(".env.example"), /POSTGRES_PORT=5434/)
    assert.match(
      text("apps/api/compose.test.yml"),
      /\.\/target\/fixture:\/work\/target/
    )
    assert.doesNotMatch(
      text("apps/api/compose.frontend.yml"),
      /\/tmp\/skull-rust-target/
    )
    assert.doesNotMatch(
      text("apps/api/Dockerfile"),
      /--features fixtures|FROM node:/
    )
    const locales = JSON.parse(text("apps/api/assets/locales.json"))
    assert.equal(locales.baseLocale, profile === "fr" ? "fr" : "en")
    const designSource = new URL(
      profile === "fr"
        ? "../../template/locales/fr/docs/DESIGN.md"
        : "../../docs/DESIGN.md",
      import.meta.url
    )
    assert.equal(text("docs/DESIGN.md"), await readFile(designSource, "utf8"))
    assert.match(text("docs/DEVELOPMENT.md"), /sslmode=verify-full/)
    const project = join(directory, `${profile}-rust`)
    execFileSync(process.execPath, ["scripts/docs-check.mjs"], { cwd: project })
    execFileSync(process.execPath, ["scripts/rust/check-assets.mjs"], {
      cwd: project,
    })
    if (profile === "en") {
      const constraints = join(
        project,
        "packages/contracts/src/auth.constraints.ts"
      )
      await writeFile(
        constraints,
        (await readFile(constraints, "utf8")).replace(
          "minLength: 8",
          "minLength: 9"
        )
      )
      assert.throws(
        () =>
          execFileSync(process.execPath, ["scripts/rust/check-assets.mjs"], {
            cwd: project,
            stdio: "pipe",
          }),
        /Command failed/
      )
      execFileSync(
        process.execPath,
        ["scripts/rust/check-assets.mjs", "--write"],
        { cwd: project }
      )
      execFileSync(process.execPath, ["scripts/rust/check-assets.mjs"], {
        cwd: project,
      })
      assert.match(
        await readFile(join(project, "apps/api/src/config/auth.rs"), "utf8"),
        /PASSWORD_MIN_LENGTH: usize = 9;/
      )
    }
    execFileSync(
      "pnpm",
      [
        "install",
        "--frozen-lockfile",
        "--lockfile-only",
        "--offline",
        "--ignore-scripts",
      ],
      { cwd: project }
    )
    await assert.rejects(
      createTemplateArchive({ output: directory, profile, backend: "rust" }),
      { code: "EEXIST" }
    )
  })
}
