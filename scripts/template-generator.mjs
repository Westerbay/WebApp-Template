import { format } from "prettier"
import { execFileSync } from "node:child_process"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildUrlPatterns } from "../packages/i18n/routing-config.mjs"
import { templateProfiles } from "./template-profiles.mjs"
import {
  copyTemplateFiles,
  listTemplateFiles,
  projectBackendPaths,
} from "./template-files.mjs"

const source = fileURLToPath(new URL("../", import.meta.url))

export async function generateTemplate({
  output,
  profile = "en",
  backend = "nestjs",
}) {
  if (!output) throw new Error("An explicit output directory is required")
  if (!["nestjs", "rust"].includes(backend))
    throw new Error(`Unknown template backend: ${backend}`)
  const selected = templateProfiles.find(({ id }) => id === profile)
  if (!selected) throw new Error(`Unknown template profile: ${profile}`)
  const destination = resolve(output)
  if (destination === resolve(source))
    throw new Error("Cannot overwrite the source repository")
  // Check catalogs and documentation before creating the destination.
  const plan = await prepareTemplate(selected)
  let files = await listTemplateFiles(source)
  let rust
  if (backend === "rust") {
    const { prepareRustTemplate, includeRustFile } =
      await import("./template-rust.mjs")
    rust = await prepareRustTemplate(source, selected, plan)
    files = files.filter(includeRustFile)
  }
  await copyTemplateFiles(source, destination, files)
  await mkdir(resolve(destination, "packages/i18n/messages"), {
    recursive: true,
  })
  for (const [locale, messages] of plan.messages)
    await writeJson(
      resolve(destination, "packages/i18n/messages", `${locale}.json`),
      messages
    )
  for (const [path, content] of plan.documentation)
    await writeFile(resolve(destination, path), content)
  await writeJson(
    resolve(destination, "packages/i18n/project.inlang/settings.json"),
    plan.settings
  )
  await writeJson(
    resolve(destination, "packages/i18n/routing.json"),
    plan.routing
  )
  await writeJson(resolve(destination, "package.json"), plan.manifest)
  if (rust) {
    for (const [path, content] of rust) {
      await mkdir(resolve(destination, path, ".."), { recursive: true })
      await writeFile(
        resolve(destination, path),
        path.endsWith(".json")
          ? await format(content, { filepath: path })
          : content
      )
    }
    await writeJson(resolve(destination, "package.json"), plan.manifest)
  }
  // Let pnpm prune unused entries without installing packages or running scripts.
  execFileSync(
    "pnpm",
    [
      "install",
      "--lockfile-only",
      "--prefer-offline",
      "--ignore-scripts",
      "--no-frozen-lockfile",
    ],
    { cwd: destination, stdio: "pipe", encoding: "utf8" }
  )
  return destination
}

async function prepareTemplate({ locales, docsLocale }) {
  const settings = await readJson("packages/i18n/project.inlang/settings.json")
  const baseRouting = await readJson("packages/i18n/routing.json")
  const internalRoutes = Object.fromEntries(
    baseRouting.routes.map(({ path }) => [path, path])
  )
  const packs = new Map()
  for (const locale of new Set([settings.baseLocale, ...locales, docsLocale])) {
    const directory = resolve(source, "template/locales", locale)
    const metadata = await readJson(resolve(directory, "pack.json"))
    const messages = await readJson(resolve(directory, metadata.messages))
    let routes = internalRoutes
    if (metadata.routes !== undefined) {
      routes = await readJson(resolve(directory, metadata.routes))
    }
    packs.set(locale, {
      messages,
      routes,
      documentation: resolve(directory, metadata.documentation),
    })
  }
  const baseMessages = packs.get(settings.baseLocale).messages
  for (const locale of locales) {
    const pack = packs.get(locale)
    if (!sameKeys(baseMessages, pack.messages))
      throw new Error(`Message keys differ from source locale: ${locale}`)
    if (!sameKeys(internalRoutes, pack.routes))
      throw new Error(`Route keys differ from internal routes: ${locale}`)
  }
  const routing = {
    prefixLocales: locales.length > 1,
    routes: baseRouting.routes.map(({ path }) => ({
      path,
      localized: locales.map((locale) => [
        locale,
        packs.get(locale).routes[path],
      ]),
    })),
  }
  buildUrlPatterns(routing, locales)
  const documentation = new Map()
  const docsRoot = packs.get(docsLocale).documentation
  const documents = [
    "README.md",
    "AGENTS.md",
    ...(await readdir(resolve(source, "docs")))
      .filter((file) => file.endsWith(".md"))
      .sort()
      .map((file) => `docs/${file}`),
  ]
  for (const document of documents)
    documentation.set(
      document,
      projectBackendPaths(
        await readFile(resolve(source, docsRoot, document), "utf8")
      ).replace(
        /<!-- template-maintainers:start -->[\s\S]*?<!-- template-maintainers:end -->\n*/g,
        ""
      )
    )
  const manifest = JSON.parse(
    projectBackendPaths(JSON.stringify(await readJson("package.json")))
  )
  delete manifest.devDependencies.fflate
  for (const name of Object.keys(manifest.scripts))
    if (name.startsWith("template:")) delete manifest.scripts[name]
  return {
    messages: new Map(
      locales.map((locale) => [locale, packs.get(locale).messages])
    ),
    documentation,
    routing,
    manifest,
    settings: { ...settings, baseLocale: locales[0], locales },
  }
}

function sameKeys(left, right) {
  return (
    JSON.stringify(Object.keys(left).sort()) ===
    JSON.stringify(Object.keys(right).sort())
  )
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(source, path), "utf8"))
}

async function writeJson(path, value) {
  await writeFile(
    path,
    await format(JSON.stringify(value), {
      filepath: path,
      printWidth: 80,
      trailingComma: "es5",
      endOfLine: "lf",
    })
  )
}
