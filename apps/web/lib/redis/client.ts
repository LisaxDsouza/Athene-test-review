import { Redis } from '@upstash/redis'

export const redis = Redis.fromEnv()

export function getRedis() {
  return redis
}

export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const hit = await redis.get<T>(key)
  if (hit !== null && hit !== undefined) return hit
  const fresh = await fn()
  await redis.set(key, fresh, { ex: ttlSeconds })
  return fresh
}

export async function incrWithExpire(key: string, ttlSeconds: number): Promise<number> {
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, ttlSeconds)
  return count
}
