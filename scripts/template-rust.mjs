import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

// Remove Nest-only runtime, tooling and documentation; the frontend stays shared.
const excluded = [
  "apps/api-nestjs/",
  "packages/database/",
  "packages/email/",
  "packages/core/",
  "scripts/infra/",
  "infra/compose/",
  "infra/observability/",
  "scripts/worktree.mjs",
  "scripts/test/worktree.test.mjs",
  "scripts/test/infra-stack.test.mjs",
]

export function includeRustFile(file) {
  return !excluded.some((prefix) => file.startsWith(prefix))
}

export async function prepareRustTemplate(source, selected, plan) {
  const base = join(source, "template/backends/rust")
  const crate = join(source, "apps/api-rust")
  const overlay = new Map()
  const read = (path) => readFile(join(base, path), "utf8")
  const readCrate = (path) => readFile(join(crate, path), "utf8")
  for (const directory of ["src", "migrations", "tests"]) {
    await collect(join(crate, directory), `apps/api/${directory}`, overlay)
  }
  for (const file of [
    "Cargo.toml",
    "Cargo.lock",
    "build.rs",
    ".gitignore",
    "openapi.json",
  ]) {
    overlay.set(`apps/api/${file}`, await readCrate(file))
  }
  overlay.set("apps/web/src/lib/api/schema.d.ts", await read("schema.d.ts"))
  overlay.set(
    "apps/api/assets/locales.json",
    JSON.stringify({
      baseLocale: selected.locales[0],
      locales: selected.locales,
    })
  )
  // Emit catalogs from the locale packs, avoiding a second translation source.
  for (const [locale, catalog] of plan.messages) {
    if (!["en", "fr"].includes(locale))
      throw new Error(`Unsupported Rust email locale: ${locale}`)
    overlay.set(
      `apps/api/assets/email.${locale}.json`,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(catalog).filter(([key]) => key.startsWith("email_"))
        )
      )
    )
  }
  // Both catalogs are embedded by the shared test renderer, even in a single locale build.
  for (const locale of ["en", "fr"]) {
    const key = `apps/api/assets/email.${locale}.json`
    if (!overlay.has(key))
      overlay.set(key, await readCrate(`assets/email.${locale}.json`))
  }
  for (const [from, to] of [
    ["Dockerfile", "apps/api/Dockerfile"],
    [".dockerignore", "apps/api/.dockerignore"],
    ["Dockerfile.test", "apps/api/Dockerfile.test"],
    ["compose.test.yml", "apps/api/compose.test.yml"],
    ["compose.frontend.yml", "apps/api/compose.frontend.yml"],
  ]) {
    let content = await readCrate(from)
    if (from === "compose.test.yml" || from === "compose.frontend.yml") {
      content = content.replaceAll(
        "/tmp/skull-rust-target:/work/target",
        "./target/fixture:/work/target"
      )
    }
    overlay.set(to, content)
  }
  for (const file of ["check.sh", "runtime-check.sh"]) {
    const content = await readFile(
      join(source, "scripts/template-rust", file),
      "utf8"
    )
    overlay.set(
      `scripts/rust/${file}`,
      content
        .replaceAll("apps/api-rust", "apps/api")
        .replaceAll("node ../../scripts/template-rust/check-assets.mjs\n", "")
    )
  }
  for (const file of [
    "frontend-journeys.mjs",
    "frontend-check.mjs",
    "check-assets.mjs",
    "cli.mjs",
  ]) {
    overlay.set(`scripts/rust/${file}`, await read(`scripts/rust/${file}`))
  }
  overlay.set(
    "infra/compose/production.yml",
    await read("compose.production.yml")
  )
  const docs = join(base, "docs", selected.docsLocale)
  for (const document of plan.documentation.keys()) {
    if (document === "docs/DESIGN.md") continue
    overlay.set(document, await readFile(join(docs, document), "utf8"))
  }
  const manifest = plan.manifest
  for (const name of Object.keys(manifest.scripts)) {
    if (/^(valkey:|logs:|worktree:|db:)/.test(name) || name === "dev:logs")
      delete manifest.scripts[name]
  }
  Object.assign(manifest.scripts, {
    "clean:rust": "cargo clean --manifest-path apps/api/Cargo.toml",
    "db:migrate": "node --env-file-if-exists=.env scripts/rust/cli.mjs migrate",
    setup: "node --env-file-if-exists=.env scripts/rust/cli.mjs setup",
    "test:integration": "sh scripts/rust/check.sh",
    "test:e2e": "node scripts/rust/frontend-check.mjs",
    "project:check":
      "pnpm boundaries:check && pnpm boundaries:test && node scripts/project-check.mjs",
    "tooling:test": "pnpm boundaries:test",
    "docker:build": "docker build -t webapp-api:local apps/api",
    "api:check":
      "node scripts/rust/check-assets.mjs && node scripts/api-contract.mjs check",
    "api:generate":
      "node scripts/rust/check-assets.mjs --write && node scripts/api-contract.mjs generate",
  })
  overlay.set(".env.example", await read("env.example"))
  overlay.set(".env.production.example", await read("production.env.example"))
  const compose = await readFile(join(source, "compose.yml"), "utf8")
  overlay.set(
    "compose.yml",
    compose
      .replace("name: webapp-template", "name: webapp-template-rust")
      .replace(
        "${POSTGRES_PORT:-5432}:5432",
        "127.0.0.1:${POSTGRES_PORT:-5434}:5432"
      )
  )
  const web = JSON.parse(
    await readFile(join(source, "apps/web/package.json"), "utf8")
  )
  web.devDependencies["@playwright/test"] = "1.63.0"
  overlay.set("apps/web/package.json", JSON.stringify(web))
  const workspace = await readFile(join(source, "pnpm-workspace.yaml"), "utf8")
  overlay.set(
    "pnpm-workspace.yaml",
    workspace.replace(/^  "@(?:nestjs\/core|swc\/core)": true\n/gm, "")
  )
  overlay.set(
    "apps/api/package.json",
    JSON.stringify({
      name: "@workspace/api",
      version: "0.0.0",
      private: true,
      license: "MIT",
      scripts: {
        build: "cargo build --release --locked",
        dev: "node --env-file-if-exists=../../.env ../../scripts/rust/cli.mjs dev",
        start: "./target/release/webapp-api",
        lint: "cargo fmt --check && cargo clippy --locked --all-targets --all-features -- -D warnings",
        typecheck: "cargo check --locked --all-targets --all-features",
        test: "cargo test --locked --lib --bins --test acceptance --test parity --test runtime",
      },
    })
  )
  const turbo = JSON.parse(await readFile(join(source, "turbo.json"), "utf8"))
  delete turbo.tasks["@workspace/api#dev"]
  turbo.globalEnv.push("API_HOST")
  for (const task of ["db:generate", "db:migrate", "db:seed", "db:studio"])
    delete turbo.tasks[task]
  turbo.tasks["@workspace/api#build"] = {
    cache: false,
    outputs: ["target/release/webapp-api"],
  }
  overlay.set("turbo.json", JSON.stringify(turbo))
  overlay.set(".github/workflows/ci.yml", await read("ci.yml"))
  overlay.set(
    ".gitignore",
    `${await readFile(join(source, ".gitignore"), "utf8")}\n# Rust build artifacts\n**/target/\n!.env.production.example\n`
  )
  overlay.set(
    ".prettierignore",
    `${await readFile(join(source, ".prettierignore"), "utf8")}\n**/target/\n`
  )
  return overlay
}

async function collect(directory, prefix, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.toLowerCase().startsWith(".env")) continue
    const path = join(directory, entry.name)
    const target = `${prefix}/${entry.name}`
    if (entry.isDirectory()) await collect(path, target, files)
    else if (entry.isFile()) files.set(target, await readFile(path, "utf8"))
    else throw new Error(`Unsupported Rust source entry: ${path}`)
  }
}
