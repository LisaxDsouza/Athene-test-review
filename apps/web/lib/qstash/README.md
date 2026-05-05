# Upstash QStash + Redis helpers

## Redis (`lib/redis/client.ts`)
- `redis`: `Redis.fromEnv()` client
- `cached(key, ttlSeconds, fn)`: cache helper
- `incrWithExpire(key, ttlSeconds)`: concurrency counter helper

## QStash (`lib/qstash/client.ts`)
- `dispatchThrottled({ orgId, sourceType, url, body })`
  - Allows 3 in-flight jobs per `orgId+sourceType`
  - Queues overflow into `pending_background_jobs`
- `releaseSlot(orgId, sourceType)`
  - Decrements slot and dispatches next queued job

## Signature verification (`lib/qstash/verify.ts`)
- `verifyQStashSignature(req)` must run first in every worker route.
