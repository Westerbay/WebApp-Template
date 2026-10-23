import { z } from "zod"

const valkeyConfigSchema = z.object({
  VALKEY_ENABLED: z.enum(["true", "false"]).default("false"),
  VALKEY_URL: z.url().optional(),
  VALKEY_NAMESPACE: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .default("webapp-template"),
})

export const valkeyTimeoutMs = 2000

export function getValkeyConfig(
  source: Record<string, string | undefined> = process.env
) {
  const result = valkeyConfigSchema.safeParse(source)
  if (!result.success) throw new Error("Invalid Valkey configuration")
  const config = result.data
  if (config.VALKEY_URL) {
    const url = new URL(config.VALKEY_URL)
    if (
      !["redis:", "rediss:"].includes(url.protocol) ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid VALKEY_URL")
    }
  }
  if (config.VALKEY_ENABLED === "true" && !config.VALKEY_URL) {
    throw new Error("VALKEY_URL is required when Valkey is enabled")
  }
  if (config.VALKEY_ENABLED === "false" && config.VALKEY_URL) {
    throw new Error("VALKEY_URL requires VALKEY_ENABLED=true")
  }
  return config
}
