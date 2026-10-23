import { createHash } from "node:crypto"
import { ServiceUnavailableException } from "@nestjs/common"
import { z } from "zod"
import type { Redis } from "ioredis"
import type { ThrottlerStorage } from "@nestjs/throttler"

// One atomic operation; server time and a sequence preserve concurrent hits.
// All keys share a cluster hash tag. No raw peer identifier is stored.
export const rateLimitScript = `
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local duration = tonumber(ARGV[3])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local blocked = redis.call('PTTL', KEYS[3])
if blocked > 0 then
  return {redis.call('ZCARD', KEYS[1]), blocked, 1, blocked}
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - ttl)
local sequence = redis.call('INCR', KEYS[2])
redis.call('ZADD', KEYS[1], now, tostring(sequence))
local hits = redis.call('ZCARD', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ttl)
redis.call('PEXPIRE', KEYS[2], ttl)
if hits > limit then
  redis.call('SET', KEYS[3], '1', 'PX', duration)
  redis.call('PEXPIRE', KEYS[1], duration)
  redis.call('PEXPIRE', KEYS[2], duration)
  return {hits, ttl, 1, duration}
end
local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
return {hits, tonumber(first[2]) + ttl - now, 0, 0}
`

const storageResultSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().nonnegative(),
  z.union([z.literal(0), z.literal(1)]),
  z.number().nonnegative(),
])

export class ValkeyRateLimitStore implements ThrottlerStorage {
  constructor(
    private readonly client: Redis,
    private readonly namespace: string
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string
  ) {
    const digest = createHash("sha256")
      .update(`${throttlerName}:${key}`)
      .digest("hex")
    const prefix = `${this.namespace}:rate-limit:{${digest}}`
    try {
      const result = await this.client.eval(
        rateLimitScript,
        3,
        `${prefix}:hits`,
        `${prefix}:sequence`,
        `${prefix}:block`,
        ttl,
        limit,
        blockDuration
      )
      const [totalHits, expiresMs, blocked, blockMs] =
        storageResultSchema.parse(result)
      return {
        totalHits,
        timeToExpire: Math.ceil(expiresMs / 1000),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.ceil(blockMs / 1000),
      }
    } catch {
      throw new ServiceUnavailableException()
    }
  }
}
