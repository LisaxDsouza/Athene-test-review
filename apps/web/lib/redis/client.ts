import { Redis } from '@upstash/redis'

let _redis: Redis | null = null

/**
 * Lazy-initialized Redis client.
 * Prevents process crashes if environment variables are missing at boot time.
 */
export function getRedis(): Redis {
  if (!_redis) {
    _redis = Redis.fromEnv()
  }
  return _redis
}

/**
 * Legacy export for backward compatibility. 
 * Note: Accessing this will still trigger initialization.
 */
export const redis = new Proxy({} as Redis, {
  get: (target, prop) => {
    return (getRedis() as any)[prop]
  }
})

export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const client = getRedis()
  const hit = await client.get<T>(key)
  if (hit !== null && hit !== undefined) return hit
  const fresh = await fn()
  await client.set(key, fresh, { ex: ttlSeconds })
  return fresh
}

export async function incrWithExpire(key: string, ttlSeconds: number): Promise<number> {
  const client = getRedis()
  const count = await client.incr(key)
  if (count === 1) await client.expire(key, ttlSeconds)
  return count
}
