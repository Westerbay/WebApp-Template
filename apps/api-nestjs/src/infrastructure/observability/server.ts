import { createServer } from "node:http"
import { once } from "node:events"
import { HttpStatus } from "@nestjs/common"
import { metricsRequestTimeoutMs } from "./observability.config.js"
import type { Server } from "node:http"
import type { ApiMetrics } from "./metrics.js"

export interface MetricsServer {
  server: Server
  close: () => Promise<void>
}

export async function startMetricsServer(
  metrics: ApiMetrics,
  address: { host: string; port: number }
): Promise<MetricsServer> {
  const server = createServer((request, response) => {
    if (request.url !== "/metrics") {
      response.writeHead(HttpStatus.NOT_FOUND).end()
      return
    }
    if (request.method !== "GET") {
      response.writeHead(HttpStatus.METHOD_NOT_ALLOWED, { Allow: "GET" }).end()
      return
    }
    const sendMetrics = async () => {
      try {
        const body = await metrics.collect()
        response
          .writeHead(HttpStatus.OK, {
            "Content-Type": metrics.registry.contentType,
            "Cache-Control": "no-store",
          })
          .end(body)
      } catch {
        // A failed scrape remains visible to Prometheus; no provider details leak.
        response
          .writeHead(HttpStatus.SERVICE_UNAVAILABLE)
          .end("Metrics collection failed\n")
      }
    }
    void sendMetrics()
  })
  server.requestTimeout = metricsRequestTimeoutMs
  server.headersTimeout = metricsRequestTimeoutMs
  server.listen(address.port, address.host)
  await once(server, "listening")
  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
      server.closeIdleConnections()
    })
  return { server, close }
}
