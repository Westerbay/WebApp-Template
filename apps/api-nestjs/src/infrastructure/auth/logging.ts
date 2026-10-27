import type { Logger } from "pino"

// Provider messages can contain credentials or personal data. Only report severity.
export function createProviderLogger(logger: Logger) {
  return (level: string) => {
    const event = { event: "auth.provider", providerLevel: level }
    if (level === "error") {
      logger.error(event)
      return
    }
    if (level === "warn") {
      logger.warn(event)
      return
    }
    logger.info(event)
  }
}
