export type ShutdownResource = Readonly<{
  close: () => void | Promise<unknown>
  name: string
}>

export type ShutdownEvent = Readonly<{
  event: "api.stopping" | "api.stopped" | "api.shutdown_failed"
  resource?: ShutdownResource["name"]
}>

export function createShutdown(
  resources: ReadonlyArray<ShutdownResource>,
  report: (event: ShutdownEvent) => void
): () => Promise<void> {
  let operation: Promise<void> | undefined

  return () => {
    operation ??= (async () => {
      report({ event: "api.stopping" })
      const failures: Array<unknown> = []
      for (const resource of resources) {
        try {
          await resource.close()
        } catch (error) {
          failures.push(error)
          report({ event: "api.shutdown_failed", resource: resource.name })
        }
      }
      if (failures.length > 0)
        throw new AggregateError(failures, "API_SHUTDOWN_FAILED")
      report({ event: "api.stopped" })
    })()
    return operation
  }
}
