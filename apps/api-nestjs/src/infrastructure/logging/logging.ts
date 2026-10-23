import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { hostname } from "node:os"
import pino from "pino"
import type { DestinationStream, Logger, TransportSingleOptions } from "pino"
import type { ApiEnv } from "../../config/env.js"
import type { LoggingOptions } from "./logging.config.js"

const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.set-cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "response.headers.set-cookie",
  "authorization",
  "cookie",
  "password",
  "token",
  "url",
  "email",
  "ip",
  "err.message",
  "error.message",
]

export function createApiLogger(
  environment: ApiEnv["APP_ENV"],
  destination?: DestinationStream,
  options: LoggingOptions = {}
): Logger {
  const pretty =
    options.format === "pretty" ||
    (environment === "development" && options.format !== "json")
  let transport: TransportSingleOptions | undefined
  if (pretty && !destination) {
    transport = {
      target: "pino-pretty",
      options: { colorize: true, singleLine: true },
    }
  }

  const level =
    options.level ?? (environment === "production" ? "info" : "debug")
  let output = destination
  if (options.file && !destination) {
    mkdirSync(dirname(options.file), { recursive: true })
    output = pino.multistream([
      { level, stream: process.stdout },
      { level, stream: pino.destination({ dest: options.file, sync: true }) },
    ])
  }

  return pino(
    {
      enabled: environment !== "test",
      level,
      formatters: {
        level: (severity, numericLevel) => ({ level: numericLevel, severity }),
      },
      base: {
        service_name: "webapp-template-api",
        environment,
        instance_id: hostname(),
        version: options.version ?? "unknown",
      },
      redact: { paths: REDACTED_PATHS, censor: "[Redacted]" },
      transport,
    },
    output
  )
}
