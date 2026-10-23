import { DEFAULT_LOCALE } from "@workspace/i18n/config"
import { describe, expect, it } from "vitest"
import { AuthEmailDispatcher } from "../../../../src/infrastructure/email/auth-email-dispatcher.js"
import type { EmailEvent } from "../../../../src/infrastructure/email/auth-email-dispatcher.js"

const input = {
  kind: "verification",
  to: "test@example.test",
  url: "https://example.test?token=private-token",
  locale: DEFAULT_LOCALE,
  requestId: "request-test-1",
} as const

describe("tracked auth email dispatch", () => {
  it("returns immediately and drains a failed delivery without leaking provider details", async () => {
    const events: Array<EmailEvent> = []
    const dispatcher = new AuthEmailDispatcher(
      {
        send: () =>
          Promise.reject(
            new Error("private-password smtp.example.test test@example.test")
          ),
      },
      (event) => {
        events.push(event)
      }
    )
    dispatcher.enqueue(input)
    await dispatcher.drain()
    expect(events).toEqual([
      {
        event: "email.failed",
        kind: "verification",
        requestId: "request-test-1",
        durationMs: expect.any(Number),
      },
    ])
  })
  it("bounds shutdown when delivery never settles", async () => {
    const events: Array<EmailEvent> = []
    const dispatcher = new AuthEmailDispatcher(
      { send: () => new Promise(() => {}) },
      (event) => {
        events.push(event)
      }
    )
    dispatcher.enqueue(input)
    await dispatcher.drain(20)
    expect(events).toEqual([{ event: "email.drain_timeout" }])
  })
})
