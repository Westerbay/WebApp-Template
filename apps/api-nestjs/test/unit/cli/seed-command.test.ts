import { expect, it } from "vitest"

import { parseSeedCommand } from "../../../src/cli/seed-command.js"

it.each([
  { arguments_: [] },
  { arguments_: ["--all", "--scenario", "auth"] },
  { arguments_: ["--scenario"] },
  { arguments_: ["--scenario", ""] },
  { arguments_: ["--all", "extra"] },
])("rejects ambiguous or incomplete arguments $arguments_", ({ arguments_ }) =>
  expect(() => parseSeedCommand(arguments_)).toThrow("Usage:")
)

it("parses one named scenario or all scenarios with optional clean", () => {
  expect(parseSeedCommand(["--scenario", "auth"])).toEqual({
    clean: false,
    selection: { kind: "scenario", name: "auth" },
  })
  expect(parseSeedCommand(["--all", "--clean"])).toEqual({
    clean: true,
    selection: { kind: "all" },
  })
})
