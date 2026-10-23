import { z } from "zod"
import { apiConfig } from "./api.config.js"

const envSchema = z.object({
  APP_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  API_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65_535)
    .default(apiConfig.defaultPort),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  DATABASE_URL: z.url(),
  WEB_URL: z.url(),
})

export type ApiEnv = z.infer<typeof envSchema>

const originKeys: ReadonlyArray<"WEB_URL" | "BETTER_AUTH_URL"> = [
  "WEB_URL",
  "BETTER_AUTH_URL",
]

export function getEnv(
  source: Record<string, string | undefined> = process.env
) {
  const result = envSchema.safeParse(source)

  if (!result.success) {
    throw new Error(
      `Invalid API environment: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`
    )
  }

  for (const key of originKeys) {
    const url = new URL(result.data[key])
    const deployed = ["staging", "production"].includes(result.data.APP_ENV)
    const insecure = deployed && url.protocol !== "https:"
    const invalidOrigin =
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    if (insecure || invalidOrigin)
      throw new Error(`Invalid API environment: ${key}`)
  }
  return result.data
}
