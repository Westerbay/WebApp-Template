import type { SeedCommand } from "../seeds/seed.js"

const USAGE = "Usage: db:seed -- (--scenario <name> | --all) [--clean]"

export function parseSeedCommand(
  arguments_: ReadonlyArray<string>
): SeedCommand {
  const cleanCount = arguments_.filter((value) => value === "--clean").length
  const values = arguments_.filter((value) => value !== "--clean")
  if (cleanCount > 1) throw new Error(USAGE)
  if (values.length === 1 && values[0] === "--all") {
    return { clean: cleanCount === 1, selection: { kind: "all" } }
  }
  if (
    values.length === 2 &&
    values[0] === "--scenario" &&
    values[1] &&
    !values[1].startsWith("--")
  ) {
    return {
      clean: cleanCount === 1,
      selection: { kind: "scenario", name: values[1] },
    }
  }
  throw new Error(USAGE)
}
