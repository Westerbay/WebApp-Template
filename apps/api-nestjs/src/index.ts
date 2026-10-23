import { startApi } from "./bootstrap.js"

const shutdown = await startApi()

const handleShutdownFailure = () => {
  process.exitCode = 1
}

const handleSignal = () => {
  void shutdown().catch(handleShutdownFailure)
}

process.once("SIGINT", handleSignal)
process.once("SIGTERM", handleSignal)
