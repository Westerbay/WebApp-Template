import { hostname } from "node:os"
import { HttpStatus } from "@nestjs/common"
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "@prometheus-io/client"
import { getHttpRoute } from "./http-route.js"
import { httpDurationBucketsSeconds } from "./observability.config.js"
import type { RequestHandler } from "express"
import type { ApiEnv } from "../../config/env.js"
import type { EmailEvent } from "../email/auth-email-dispatcher.js"

const httpMethods = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
])

export interface ApiMetrics {
  registry: Registry
  middleware: RequestHandler
  recordEmail: (event: EmailEvent) => void
  close: () => void
  collect: () => Promise<string>
}

export function createApiMetrics(
  environment: ApiEnv["APP_ENV"],
  version: string,
  dependencies: { valkey: boolean } = { valkey: false }
): ApiMetrics {
  const registry = new Registry()
  registry.setDefaultLabels({
    service_name: "webapp-template-api",
    environment,
    instance_id: hostname(),
  })
  collectDefaultMetrics({ register: registry })
  new Gauge({
    name: "webapp_template_build_info",
    help: "Deployed application version.",
    labelNames: ["version"],
    registers: [registry],
  }).set({ version }, 1)
  const requests = new Counter({
    name: "webapp_template_http_requests_total",
    help: "Completed API requests, including auth and probes.",
    labelNames: ["method", "route", "status"],
    registers: [registry],
  })
  const duration = new Histogram({
    name: "webapp_template_http_request_duration_seconds",
    help: "API response duration in seconds; includes successful and failed responses.",
    labelNames: ["method", "route", "outcome"],
    buckets: httpDurationBucketsSeconds,
    registers: [registry],
  })
  const inFlight = new Gauge({
    name: "webapp_template_http_requests_in_flight",
    help: "Requests currently being served by this API instance.",
    registers: [registry],
  })
  inFlight.set(0)
  const aborted = new Counter({
    name: "webapp_template_http_requests_aborted_total",
    help: "Connections closed before a response completed.",
    registers: [registry],
  })
  const emails = new Counter({
    name: "webapp_template_email_events_total",
    help: "Auth email transport outcomes; accepted does not mean delivered to an inbox.",
    labelNames: ["event", "kind"],
    registers: [registry],
  })
  for (const kind of ["verification", "reset"]) {
    for (const event of ["email.accepted", "email.failed"])
      emails.inc({ event, kind }, 0)
  }
  const emailDuration = new Histogram({
    name: "webapp_template_email_dispatch_duration_seconds",
    help: "Time from enqueue to transport outcome, including rendering.",
    labelNames: ["kind", "outcome"],
    buckets: httpDurationBucketsSeconds,
    registers: [registry],
  })
  const middleware: RequestHandler = (request, response, next) => {
    const start = performance.now()
    inFlight.inc()
    let complete = false
    const finish = () => {
      if (complete) return
      complete = true
      inFlight.dec()
      if (!response.writableFinished) {
        aborted.inc()
        return
      }
      const route = getHttpRoute(request)
      const method = httpMethods.has(request.method) ? request.method : "OTHER"
      requests.inc({ method, route, status: String(response.statusCode) })
      let outcome = "success"
      if (response.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR)
        outcome = "server_error"
      else if (response.statusCode >= HttpStatus.BAD_REQUEST)
        outcome = "client_error"
      duration.observe(
        { method, route, outcome },
        (performance.now() - start) / 1000
      )
    }
    response.once("finish", finish)
    response.once("close", finish)
    next()
  }
  const recordEmail = (event: EmailEvent) => {
    emails.inc({ event: event.event, kind: event.kind ?? "all" })
    if (event.durationMs !== undefined && event.kind) {
      emailDuration.observe(
        {
          kind: event.kind,
          outcome: event.event === "email.accepted" ? "accepted" : "failed",
        },
        event.durationMs / 1000
      )
    }
  }
  const enabled = new Gauge({
    name: "webapp_template_dependency_enabled",
    help: "Whether this API instance uses a dependency.",
    labelNames: ["dependency"],
    registers: [registry],
  })
  enabled.set({ dependency: "postgres" }, 1)
  enabled.set({ dependency: "valkey" }, Number(dependencies.valkey))
  return {
    registry,
    middleware,
    recordEmail,
    collect: () => registry.metrics(),
    close: () => registry.clear(),
  }
}
