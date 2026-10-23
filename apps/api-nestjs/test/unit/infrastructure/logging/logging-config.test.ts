import { describe, expect, it } from "vitest"
import { getLoggingConfig } from "../../../../src/infrastructure/logging/logging.config.js"

describe("logging configuration", () => {
  it("selects JSON for the local mirror", () => {
    expect(
      getLoggingConfig("development", { LOG_FILE: "output/api.jsonl" })
    ).toMatchObject({ format: "json", file: "output/api.jsonl" })
  })

  it("rejects pretty files and deployed file logging", () => {
    expect(() =>
      getLoggingConfig("development", {
        LOG_FORMAT: "pretty",
        LOG_FILE: "output/api.jsonl",
      })
    ).toThrow("LOG_FILE")
    const environments: Array<"staging" | "production" | "test"> = [
      "staging",
      "production",
      "test",
    ]
    for (const environment of environments) {
      expect(() =>
        getLoggingConfig(environment, { LOG_FILE: "output/api.jsonl" })
      ).toThrow("JSON stdout")
      expect(() =>
        getLoggingConfig(environment, { LOG_FORMAT: "pretty" })
      ).toThrow("JSON stdout")
    }
  })

  it("rejects invalid settings without exposing their values", () => {
    expect(() =>
      getLoggingConfig("development", {
        LOG_LEVEL: "private-invalid-level",
      })
    ).toThrow("LOG_LEVEL")
    expect(() =>
      getLoggingConfig("development", {
        LOG_LEVEL: "private-invalid-level",
      })
    ).not.toThrow("private-invalid-level")
  })
})
