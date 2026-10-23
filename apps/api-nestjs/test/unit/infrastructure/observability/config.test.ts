import { expect, it } from "vitest"
import { getObservabilityConfig } from "../../../../src/infrastructure/observability/observability.config.js"

it("keeps metrics opt-in and rejects malformed listener/release settings without exposing their values", () => {
  const defaults = getObservabilityConfig({})
  expect(defaults.METRICS_ENABLED).toBe("false")
  expect(defaults.METRICS_HOST).toBe("127.0.0.1")
  for (const source of [
    { METRICS_ENABLED: "yes" },
    { METRICS_PORT: "0" },
    { METRICS_PORT: "65536" },
    { METRICS_HOST: "" },
    { APP_VERSION: "private-secret\ninvalid" },
  ]) {
    expect(() => getObservabilityConfig(source)).toThrow(
      "Invalid observability configuration"
    )
    expect(() => getObservabilityConfig(source)).not.toThrow("private-secret")
  }
})
