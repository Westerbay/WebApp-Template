import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "../..")
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const [command, ...args] = process.argv.slice(2)
if (args[0] === "--") args.shift()
if (command === "setup") {
  if (args.length) throw new Error("setup accepts no arguments")
  if (
    process.env.APP_ENV !== "development" ||
    process.env.DATABASE_FIXTURE_MODE !== "enabled"
  )
    throw new Error(
      "setup requires an explicitly configured local development environment"
    )
  run("docker", ["compose", "up", "-d", "--wait"])
}
if (["migrate", "setup", "dev"].includes(command)) {
  const cargo = [
    "run",
    "--manifest-path",
    "apps/api/Cargo.toml",
    "--locked",
    "--",
  ]
  if (command !== "dev") cargo.push("--migrate", ...args)
  else if (args.length) throw new Error("dev accepts no arguments")
  run("cargo", cargo)
} else throw new Error("Usage: cli.mjs <setup|migrate|dev>")
