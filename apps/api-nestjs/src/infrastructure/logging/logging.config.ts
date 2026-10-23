import { z } from "zod"
import type { ApiEnv } from "../../config/env.js"

export interface LoggingOptions {
  readonly format?: "json" | "pretty"
  readonly level?:
    | "trace"
    | "debug"
    | "info"
    | "warn"
    | "error"
    | "fatal"
    | "silent"
  readonly file?: string
  readonly version?: string
}

const loggingSchema = z.object({
  LOG_FORMAT: z.enum(["json", "pretty"]).optional(),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .optional(),
  LOG_FILE: z.string().trim().min(1).optional(),
})

export function getLoggingConfig(
  environment: ApiEnv["APP_ENV"],
  source: Record<string, string | undefined> = process.env
): LoggingOptions {
  const result = loggingSchema.safeParse(source)
  if (!result.success) {
    throw new Error(
      "Invalid logging configuration: " +
        result.error.issues.map((issue) => issue.path.join(".")).join(", ")
    )
  }

  const { LOG_FORMAT, LOG_LEVEL, LOG_FILE } = result.data
  if (environment !== "development" && (LOG_FORMAT === "pretty" || LOG_FILE)) {
    throw new Error("Deployed and test logging requires JSON stdout")
  }
  if (LOG_FILE && LOG_FORMAT === "pretty") {
    throw new Error("LOG_FILE requires JSON logging")
  }

  let format = LOG_FORMAT
  if (!format && LOG_FILE) {
    format = "json"
  }

  return {
    format,
    level: LOG_LEVEL,
    file: LOG_FILE,
  }
}
