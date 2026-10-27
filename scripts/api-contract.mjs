import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { existsSync } from "node:fs"

const mode = process.argv[2]
const root = resolve(import.meta.dirname, "..")
const rustSource = process.argv[3] === "--rust"
if (process.argv.length > 4 || (process.argv[3] && !rustSource)) {
  throw new Error("Usage: api-contract.mjs <generate|check> [--rust]")
}
const apiDirectory = rustSource ? "apps/api-rust" : "apps/api-nestjs"
const isRust = existsSync(join(root, apiDirectory, "Cargo.toml"))
if (rustSource && !isRust) throw new Error("Rust source crate not found")
const outputDirectory = rustSource
  ? "template/backends/rust"
  : "apps/web/src/lib/api"
const committedSpec = join(root, apiDirectory, "openapi.json")
const committedTypes = join(root, outputDirectory, "schema.d.ts")
const committedValidators = join(root, outputDirectory, "responses.zod.ts")

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 1}`)
  }
}

async function generate(specPath, typesPath, validatorsPath) {
  if (isRust) {
    const result = spawnSync(
      "cargo",
      [
        "run",
        "--manifest-path",
        `${apiDirectory}/Cargo.toml`,
        "--locked",
        "--",
        "--openapi",
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
    )
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error("Rust OpenAPI export failed")
    await writeFile(specPath, result.stdout)
    const generator = rustSource
      ? new URL(
          "../template/backends/rust/scripts/rust/generate-zod.mjs",
          import.meta.url
        )
      : new URL("./rust/generate-zod.mjs", import.meta.url)
    const { generateZod } = await import(generator.href)
    await generateZod(specPath, validatorsPath)
  } else {
    run("pnpm", ["--filter", "@workspace/api", "build"])
    run("node", ["apps/api-nestjs/dist/openapi/generate.js", specPath])
  }
  run("pnpm", [
    "--filter",
    "web",
    "exec",
    "openapi-typescript",
    specPath,
    "-o",
    typesPath,
  ])
  run("pnpm", [
    "exec",
    "prettier",
    "--config",
    join(root, ".prettierrc"),
    "--write",
    specPath,
    typesPath,
    ...(isRust ? [validatorsPath] : []),
  ])
}

if (mode === "generate") {
  await generate(committedSpec, committedTypes, committedValidators)
} else if (mode === "check") {
  const directory = await mkdtemp(join(tmpdir(), "webapp-template-api-"))
  const generatedSpec = join(directory, "openapi.json")
  const generatedTypes = join(directory, "schema.d.ts")
  const generatedValidators = join(directory, "responses.zod.ts")

  try {
    await generate(generatedSpec, generatedTypes, generatedValidators)
    const files = [
      [committedSpec, generatedSpec],
      [committedTypes, generatedTypes],
      ...(isRust ? [[committedValidators, generatedValidators]] : []),
    ]

    for (const [committed, generated] of files) {
      const [committedContent, generatedContent] = await Promise.all([
        readFile(committed, "utf8"),
        readFile(generated, "utf8"),
      ])

      if (committedContent !== generatedContent) {
        console.error(`API contract drift detected in ${committed}`)
        process.exitCode = 1
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
} else {
  console.error("Usage: api-contract.mjs <generate|check> [--rust]")
  process.exitCode = 1
}
