import { z } from "zod"

const observabilitySchema = z.object({
  METRICS_ENABLED: z.enum(["true", "false"]).default("false"),
  METRICS_HOST: z.string().trim().min(1).default("127.0.0.1"),
  METRICS_PORT: z.coerce.number().int().min(1).max(65_535).default(9464),
  APP_VERSION: z
    .string()
    .regex(/^[a-zA-Z0-9._+-]{1,128}$/)
    .default("unknown"),
})

export const httpDurationBucketsSeconds = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]
export const metricsRequestTimeoutMs = 5000

export function getObservabilityConfig(
  source: Record<string, string | undefined> = process.env
) {
  const result = observabilitySchema.safeParse(source)
  if (!result.success) {
    throw new Error(
      "Invalid observability configuration: " +
        result.error.issues.map((issue) => issue.path.join(".")).join(", ")
    )
  }
  return result.data
}
