import { Redis } from "ioredis"
import { valkeyTimeoutMs } from "./valkey.config.js"

export interface ValkeyConnection {
  client: Redis
  ready: () => Promise<void>
  close: () => Promise<void>
}

export function createValkey(
  url: string,
  reportUnavailable: () => void
): ValkeyConnection {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: valkeyTimeoutMs,
    commandTimeout: valkeyTimeoutMs,
    maxRetriesPerRequest: 0,
  })
  client.on("error", reportUnavailable)
  const ready = async () => {
    await client.ping()
  }
  const close = () => {
    client.disconnect()
    return Promise.resolve()
  }
  return { client, ready, close }
}
