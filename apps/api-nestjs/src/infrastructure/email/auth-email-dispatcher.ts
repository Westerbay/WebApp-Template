import { renderAuthEmail } from "@workspace/email"
import type { AuthEmailInput } from "@workspace/email"
import type { EmailSender } from "@workspace/core/email"

const EMAIL_DRAIN_TIMEOUT_MS = 15_000 // 15 seconds

export interface EmailEvent {
  event: "email.accepted" | "email.failed" | "email.drain_timeout"
  kind?: AuthEmailInput["kind"]
  requestId?: string
  durationMs?: number
}

type AuthEmailDispatchInput = AuthEmailInput & Readonly<{ requestId?: string }>

export class AuthEmailDispatcher {
  private readonly pending = new Set<Promise<void>>()
  private stopping = false
  constructor(
    private readonly sender: EmailSender,
    private readonly report: (event: EmailEvent) => void
  ) {}

  enqueue(input: AuthEmailDispatchInput) {
    const started = performance.now()
    const context = input.requestId ? { requestId: input.requestId } : {}
    if (this.stopping) {
      this.report({
        event: "email.failed",
        kind: input.kind,
        ...context,
      })
      return
    }
    const operation = Promise.resolve()
      .then(async () => {
        const message = await renderAuthEmail(input)
        await this.sender.send(message)
        this.report({
          event: "email.accepted",
          kind: input.kind,
          durationMs: performance.now() - started,
          ...context,
        })
      })
      .catch(() => {
        this.report({
          event: "email.failed",
          kind: input.kind,
          durationMs: performance.now() - started,
          ...context,
        })
      })
    this.pending.add(operation)
    void operation.then(() => {
      this.pending.delete(operation)
    })
  }

  async drain(timeoutMs = EMAIL_DRAIN_TIMEOUT_MS) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.all(this.pending),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            this.report({ event: "email.drain_timeout" })
            resolve()
          }, timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  async close() {
    this.stopping = true
    await this.drain()
  }
}
