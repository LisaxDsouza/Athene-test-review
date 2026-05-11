import { Redis } from '@upstash/redis'

let _redis: Redis | null = null

export function getRedis(): Redis {
  if (!_redis) _redis = Redis.fromEnv()
  return _redis
}

export const redis = new Proxy({} as Redis, {
  get(_, prop) {
    return (getRedis() as any)[prop]
  },
})

export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const hit = await getRedis().get<T>(key)
  if (hit !== null && hit !== undefined) return hit
  const fresh = await fn()
  await getRedis().set(key, fresh, { ex: ttlSeconds })
  return fresh
}

export async function incrWithExpire(key: string, ttlSeconds: number): Promise<number> {
  const count = await getRedis().incr(key)
  if (count === 1) await getRedis().expire(key, ttlSeconds)
  return count
}
