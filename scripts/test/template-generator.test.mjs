import { test } from "node:test"
import { unzipSync } from "fflate"
import assert from "node:assert/strict"
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  access,
  cp,
  mkdir,
  writeFile,
  symlink,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { buildUrlPatterns } from "../../packages/i18n/routing-config.mjs"
import { templateProfiles } from "../template-profiles.mjs"
import { generateTemplate } from "../template-generator.mjs"
import { projectBackendPaths } from "../template-files.mjs"
import { createTemplateArchive } from "../template-archives.mjs"

const source = fileURLToPath(new URL("../../", import.meta.url))
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"))
const requireI18n = createRequire(
  new URL("../../packages/i18n/package.json", import.meta.url)
)
const { compile } = await import(
  pathToFileURL(requireI18n.resolve("@inlang/paraglide-js")).href
)

for (const { id, locales, docsLocale } of templateProfiles) {
  test(`generates the ${id} profile with working translated URLs`, async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), "webapp-template-template-test-")
    )
    try {
      const directory = join(temporary, "missing", "nested")
      const output = join(directory, id)
      const archive = await createTemplateArchive({
        output: directory,
        profile: id,
      })
      assert.equal(basename(archive), `webapp-template-${id}.zip`)
      const archiveBytes = await readFile(archive)
      const entries = unzipSync(archiveBytes)
      const names = Object.keys(entries)
      const documentNames = (await readdir(join(source, "docs")))
        .filter((name) => name.endsWith(".md"))
        .sort()
      assert.deepEqual(
        names.filter((name) => /^docs\/[^/]+\.md$/.test(name)).sort(),
        documentNames.map((name) => `docs/${name}`)
      )
      const packDirectory = join(source, "template/locales", docsLocale)
      const pack = await readJson(join(packDirectory, "pack.json"))
      const documentationRoot = resolve(packDirectory, pack.documentation)
      for (const name of documentNames) {
        const expected = projectBackendPaths(
          await readFile(join(documentationRoot, "docs", name), "utf8")
        ).replace(
          /<!-- template-maintainers:start -->[\s\S]*?<!-- template-maintainers:end -->\n*/g,
          ""
        )
        assert.equal(
          Buffer.from(entries[`docs/${name}`]).toString("utf8"),
          expected,
          `Wrong documentation language for ${id}: ${name}`
        )
      }
      for (const required of [
        "README.md",
        "package.json",
        "pnpm-lock.yaml",
        ".env.example",
        ".gitignore",
        ".github/workflows/ci.yml",
      ])
        assert.ok(entries[required], `Missing ZIP entry: ${required}`)
      assert.deepEqual(
        names
          .filter((name) => name.startsWith("packages/i18n/messages/"))
          .sort(),
        locales.map((locale) => `packages/i18n/messages/${locale}.json`).sort()
      )
      for (const name of names) {
        assert.ok(!/\.(zip|tgz|tar\.gz)$/.test(name), `Nested archive: ${name}`)
        assert.ok(
          !name.startsWith("apps/api-nestjs/") &&
            !name.startsWith("apps/api-rust/") &&
            !name.startsWith("template/") &&
            !name.startsWith("scripts/template-") &&
            !name.startsWith("scripts/test/template-") &&
            !name.startsWith(".github/workflows/template"),
          `Maintainer-only ZIP entry: ${name}`
        )
        assert.ok(
          !name
            .split("/")
            .some((part) =>
              [".git", "node_modules", "dist", "output"].includes(part)
            )
        )
        assert.ok(
          !name
            .split("/")
            .some((part) => part.startsWith(".env") && part !== ".env.example")
        )
      }
      assert.equal(
        Buffer.from(entries["README.md"]).toString("utf8"),
        await readFile(join(output, "README.md"), "utf8")
      )
      assert.deepEqual(
        (await readdir(join(output, "packages/i18n/messages"))).sort(),
        locales.map((locale) => `${locale}.json`).sort()
      )
      const settings = await readJson(
        join(output, "packages/i18n/project.inlang/settings.json")
      )
      assert.equal(settings.baseLocale, locales[0])
      assert.deepEqual(settings.locales, locales)
      const routing = await readJson(join(output, "packages/i18n/routing.json"))
      assert.equal(routing.prefixLocales, locales.length > 1)
      const signin = routing.routes.find(({ path }) => path === "/sign-in")
      if (locales.includes("fr"))
        assert.ok(
          signin.localized.some(
            ([locale, path]) => locale === "fr" && path === "/connexion"
          )
        )
      const readme = await readFile(join(output, "README.md"), "utf8")
      const manifest = await readJson(join(output, "package.json"))
      assert.equal(manifest.devDependencies.fflate, undefined)
      assert.ok(
        !Object.keys(manifest.scripts).some((name) =>
          name.startsWith("template:")
        )
      )
      const lockfile = await readFile(join(output, "pnpm-lock.yaml"), "utf8")
      assert.ok(!lockfile.includes("fflate"))
      execFileSync(
        "pnpm",
        [
          "install",
          "--frozen-lockfile",
          "--lockfile-only",
          "--offline",
          "--ignore-scripts",
        ],
        { cwd: output }
      )
      assert.equal(
        await readFile(join(output, "pnpm-lock.yaml"), "utf8"),
        lockfile
      )
      assert.ok(names.some((name) => name.startsWith("apps/api/test/")))
      assert.ok(!names.includes("apps/api/Cargo.toml"))
      assert.match(
        Buffer.from(entries["scripts/infra/test-auth.mjs"]).toString("utf8"),
        /apps\/api\/dist\/cli\/seed/
      )
      assert.ok(lockfile.includes("  apps/api:"))
      assert.ok(!lockfile.includes("apps/api-nestjs"))
      assert.ok(names.some((name) => name.startsWith("apps/web/test/")))
      for (const name of names.filter(
        (name) => name === "README.md" || name.startsWith("docs/")
      )) {
        const content = Buffer.from(entries[name]).toString("utf8")
        assert.doesNotMatch(
          content,
          /template:|scripts\/template-|template\/locales|template-maintainers:|webapp-template-.*\.zip|v0\.1\.0/,
          `Maintainer instructions in ${name}`
        )
      }
      assert.ok(readme.includes("packages/i18n"))
      assert.ok(readme.includes("https://github.com/Westerbay/WebApp-Template"))
      assert.equal(
        await readFile(join(output, ".github/workflows/ci.yml"), "utf8"),
        projectBackendPaths(
          await readFile(join(source, ".github/workflows/ci.yml"), "utf8")
        )
      )
      for (const excluded of [
        "template",
        ".env",
        ".git",
        "scripts/template-create.mjs",
        ".github/workflows/templates.yml",
        ".github/workflows/template-validation.yml",
        ".github/workflows/template-release.yml",
      ])
        await assert.rejects(access(join(output, excluded)))
      execFileSync(process.execPath, ["scripts/docs-check.mjs"], {
        cwd: output,
      })
      await verifyRouting(output, settings, routing)
      await assert.rejects(generateTemplate({ output, profile: id }), {
        code: "EEXIST",
      })
      assert.equal(await readFile(join(output, "README.md"), "utf8"), readme)
      await assert.rejects(
        createTemplateArchive({ output: directory, profile: id }),
        { code: "EEXIST" }
      )
      assert.deepEqual(await readFile(archive), archiveBytes)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })
}

test("refuses an unknown profile before creating output", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "webapp-template-template-invalid-")
  )
  try {
    const output = join(temporary, "project")
    await assert.rejects(
      generateTemplate({ output, profile: "unknown" }),
      /Unknown template profile/
    )
    await assert.rejects(access(output))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test("rejects a newly added document without a French translation before creating output", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "template-missing-doc-"))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const fixture = join(temporary, "source")
  for (const file of [
    "scripts/template-generator.mjs",
    "scripts/template-files.mjs",
    "scripts/template-profiles.mjs",
    "packages/i18n/routing-config.mjs",
    "packages/i18n/routing.json",
    "packages/i18n/messages/en.json",
    "template/locales/en/pack.json",
    "template/locales/fr/pack.json",
    "packages/i18n/project.inlang/settings.json",
    "template/locales/fr/messages.json",
    "template/locales/fr/routes.json",
    "template/locales/fr/README.md",
    "template/locales/fr/AGENTS.md",
  ]) {
    const target = join(fixture, file)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(source, file), target)
  }
  await mkdir(join(fixture, "docs"))
  await writeFile(join(fixture, "docs/NEW.md"), "# New guide\n")
  await symlink(
    join(source, "node_modules"),
    join(fixture, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  )
  const { generateTemplate: generateFixture } = await import(
    pathToFileURL(join(fixture, "scripts/template-generator.mjs")).href
  )
  const output = join(temporary, "output")
  await assert.rejects(generateFixture({ output, profile: "fr" }), {
    code: "ENOENT",
    path: join(fixture, "template/locales/fr/docs/NEW.md"),
  })
  await assert.rejects(access(output), { code: "ENOENT" })
})

test("CLI accepts pnpm's separator and a French profile", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "webapp-template-template-cli-")
  )
  try {
    const output = join(temporary, "project")
    execFileSync(process.execPath, [
      "scripts/template-create.mjs",
      "--",
      "--profile",
      "fr",
      "--output",
      output,
    ])
    assert.deepEqual(await readdir(join(output, "packages/i18n/messages")), [
      "fr.json",
    ])
    assert.ok(
      (await readFile(join(output, "README.md"), "utf8")).includes(
        "Application web TypeScript"
      )
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

async function createLocaleFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "template-locale-pack-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fixture = join(directory, "source")
  for (const file of [
    "scripts/template-generator.mjs",
    "scripts/template-files.mjs",
    "packages/i18n/routing-config.mjs",
    "packages/i18n/routing.json",
    "packages/i18n/messages/en.json",
    "packages/i18n/project.inlang/settings.json",
    "template/locales/en/pack.json",
  ]) {
    const target = join(fixture, file)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(source, file), target)
  }
  const files = {
    ".gitignore": "node_modules\n",
    "package.json": JSON.stringify({
      name: "locale-fixture",
      private: true,
      devDependencies: { fflate: "0.8.3" },
      scripts: { "template:create": "unused", check: "unused" },
    }),
    "docs/GUIDE.md": "# Source guide\n",
    "scripts/template-profiles.mjs":
      'export const templateProfiles = [{ id: "synthetic", locales: ["en", "xx"], docsLocale: "xx" }]\n',
    "template/locales/xx/pack.json": JSON.stringify({
      messages: "catalog.json",
      routes: "paths.json",
      documentation: "manual",
    }),
    "template/locales/xx/manual/README.md": "# Synthetic project\n",
    "template/locales/xx/manual/AGENTS.md": "# Synthetic instructions\n",
    "template/locales/xx/manual/docs/GUIDE.md": "# Translated guide\n",
  }
  const messages = await readJson(
    join(fixture, "packages/i18n/messages/en.json")
  )
  messages.sign_in_title = "Synthetic sign in"
  files["template/locales/xx/catalog.json"] = JSON.stringify(messages)
  const routing = await readJson(join(fixture, "packages/i18n/routing.json"))
  const paths = Object.fromEntries(
    routing.routes.map(({ path }) => [path, path])
  )
  paths["/sign-in"] = "/synthetic-login"
  files["template/locales/xx/paths.json"] = JSON.stringify(paths)
  for (const [file, content] of Object.entries(files)) {
    const target = join(fixture, file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  await symlink(
    join(source, "node_modules"),
    join(fixture, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  )
  execFileSync("git", ["init", "--quiet", fixture])
  const { generateTemplate: generateFixture } = await import(
    pathToFileURL(join(fixture, "scripts/template-generator.mjs")).href
  )
  return { fixture, output: join(directory, "output"), generateFixture }
}

test("generates an additional locale from its pack without changing generator code", async (t) => {
  const { output, generateFixture } = await createLocaleFixture(t)
  await generateFixture({ output, profile: "synthetic" })
  assert.deepEqual(
    (await readdir(join(output, "packages/i18n/messages"))).sort(),
    ["en.json", "xx.json"]
  )
  const messages = await readJson(
    join(output, "packages/i18n/messages/xx.json")
  )
  assert.equal(messages.sign_in_title, "Synthetic sign in")
  const routing = await readJson(join(output, "packages/i18n/routing.json"))
  assert.deepEqual(
    routing.routes.find(({ path }) => path === "/sign-in").localized,
    [
      ["en", "/sign-in"],
      ["xx", "/synthetic-login"],
    ]
  )
  const settings = await readJson(
    join(output, "packages/i18n/project.inlang/settings.json")
  )
  assert.deepEqual(settings.locales, ["en", "xx"])
  assert.equal(settings.baseLocale, "en")
  assert.equal(
    await readFile(join(output, "docs/GUIDE.md"), "utf8"),
    "# Translated guide\n"
  )
  assert.equal(
    await readFile(join(output, "README.md"), "utf8"),
    "# Synthetic project\n"
  )
  await assert.rejects(access(join(output, "template")), { code: "ENOENT" })
})

for (const [file, message] of [
  ["catalog.json", "Message keys differ from source locale: xx"],
  ["paths.json", "Route keys differ from internal routes: xx"],
]) {
  test(`rejects incomplete locale ${file} before creating output`, async (t) => {
    const { fixture, output, generateFixture } = await createLocaleFixture(t)
    await writeFile(join(fixture, "template/locales/xx", file), "{}")
    await assert.rejects(generateFixture({ output, profile: "synthetic" }), {
      message,
    })
    await assert.rejects(access(output), { code: "ENOENT" })
  })
}

async function verifyRouting(output, settings, routing) {
  const outdir = join(output, "routing-test-runtime")
  await compile({
    project: join(output, "packages/i18n/project.inlang"),
    outdir,
    strategy: ["url", "baseLocale"],
    urlPatterns: buildUrlPatterns(routing, settings.locales),
  })
  await symlink(
    join(source, "packages/i18n/node_modules"),
    join(outdir, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  )
  await writeFile(
    join(outdir, "package.json"),
    JSON.stringify({ type: "module" })
  )
  const runtime = await import(pathToFileURL(join(outdir, "runtime.js")).href)
  for (const locale of settings.locales) {
    for (const route of routing.routes) {
      const original = new URL(
        "https://app.example.test" + route.path + "?redirect=%2F#form"
      )
      const publicPath = route.localized.find(
        ([language]) => language === locale
      )[1]
      const expected = routing.prefixLocales
        ? `/${locale}${publicPath === "/" ? "" : publicPath}`
        : publicPath
      const localized = runtime.localizeUrl(original, { locale })
      assert.equal(localized.pathname, expected)
      assert.equal(localized.search, original.search)
      assert.equal(localized.hash, original.hash)
      assert.equal(runtime.deLocalizeUrl(localized).href, original.href)
      assert.equal(runtime.extractLocaleFromUrl(localized), locale)
    }
  }
}
