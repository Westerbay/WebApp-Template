import { describe, expect, it, vi } from "vitest"

import { runSeedCommand } from "../../../src/seeds/seed.js"
import type { SeedScenario } from "../../../src/seeds/seed.js"

function recordingScenario(name: string, calls: Array<string>): SeedScenario {
  return {
    name,
    prepareSeed() {
      calls.push(`prepare-seed:${name}`)
      return Promise.resolve(() => {
        calls.push(`seed:${name}`)
        return Promise.resolve()
      })
    },
    prepareClean() {
      calls.push(`prepare-clean:${name}`)
      return Promise.resolve(() => {
        calls.push(`clean:${name}`)
        return Promise.resolve()
      })
    },
  }
}

describe("seed registry execution", () => {
  it("prepares all scenarios before seeding in registry order and cleaning in reverse", async () => {
    const calls: Array<string> = []
    const registry = ["auth", "catalog"].map((name) =>
      recordingScenario(name, calls)
    )
    await runSeedCommand({ clean: false, selection: { kind: "all" } }, registry)
    await runSeedCommand({ clean: true, selection: { kind: "all" } }, registry)
    expect(calls).toEqual([
      "prepare-seed:auth",
      "prepare-seed:catalog",
      "seed:auth",
      "seed:catalog",
      "prepare-clean:catalog",
      "prepare-clean:auth",
      "clean:catalog",
      "clean:auth",
    ])
  })

  it("does not mutate when a later selected scenario fails preflight", async () => {
    const mutate = vi.fn(() => Promise.resolve())
    const registry: ReadonlyArray<SeedScenario> = [
      {
        name: "first",
        prepareSeed: () => Promise.resolve(mutate),
        prepareClean: () => Promise.resolve(mutate),
      },
      {
        name: "second",
        prepareSeed: () => Promise.reject(new Error("collision")),
        prepareClean: () => Promise.reject(new Error("collision")),
      },
    ]
    await expect(
      runSeedCommand({ clean: false, selection: { kind: "all" } }, registry)
    ).rejects.toThrow("collision")
    expect(mutate).not.toHaveBeenCalled()
  })

  it("rejects unknown, empty, and duplicate registered scenarios", async () => {
    await expect(
      runSeedCommand(
        { clean: false, selection: { kind: "scenario", name: "missing" } },
        []
      )
    ).rejects.toThrow("Unknown seed scenario")
    await expect(
      runSeedCommand({ clean: false, selection: { kind: "all" } }, [
        recordingScenario(" ", []),
      ])
    ).rejects.toThrow("must not be empty")
    await expect(
      runSeedCommand({ clean: false, selection: { kind: "all" } }, [
        recordingScenario("auth", []),
        recordingScenario("auth", []),
      ])
    ).rejects.toThrow("Duplicate")
  })
})
