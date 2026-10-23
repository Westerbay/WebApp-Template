export const DATABASE_READINESS = Symbol("DATABASE_READINESS")
export const READINESS_TIMEOUT = Symbol("READINESS_TIMEOUT")

export type DatabaseReadiness = () => Promise<void>

export async function waitForReadiness(
  probe: DatabaseReadiness,
  timeoutMs: number
): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("DATABASE_READINESS_TIMEOUT")),
          timeoutMs
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
