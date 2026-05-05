import { Client } from '@upstash/qstash'
import { incrWithExpire, redis } from '@/lib/redis/client'
import { supabaseAdmin } from '@/lib/supabase/server'

export const qstash = new Client({ token: process.env.QSTASH_TOKEN! })

const CONCURRENCY_LIMIT = 3
const CONCURRENCY_TTL_SECONDS = 900

export type DispatchOptions = {
  orgId: string
  sourceType: string
  url: string
  body: Record<string, unknown>
}

export async function dispatchThrottled({
  orgId,
  sourceType,
  url,
  body,
}: DispatchOptions): Promise<{ dispatched: boolean; msgId?: string }> {
  const key = `nango_concurrency:${orgId}:${sourceType}`
  const current = await incrWithExpire(key, CONCURRENCY_TTL_SECONDS)

  if (current > CONCURRENCY_LIMIT) {
    await redis.decr(key)
    await supabaseAdmin.from('pending_background_jobs').insert({
      org_id: orgId,
      source_type: sourceType,
      url,
      body,
      status: 'waiting',
    })
    return { dispatched: false }
  }

  const res = await qstash.publishJSON({ url, body })
  return { dispatched: true, msgId: res.messageId }
}

export async function releaseSlot(orgId: string, sourceType: string) {
  const key = `nango_concurrency:${orgId}:${sourceType}`
  await redis.decr(key)

  const { data: jobs } = await supabaseAdmin
    .from('pending_background_jobs')
    .select('id, org_id, source_type, url, body')
    .eq('org_id', orgId)
    .eq('source_type', sourceType)
    .eq('status', 'waiting')
    .order('created_at', { ascending: true })
    .limit(1)

  const job = jobs?.[0]
  if (!job) return

  const { data: claimed } = await supabaseAdmin
    .from('pending_background_jobs')
    .update({ status: 'processing' })
    .eq('id', job.id)
    .eq('status', 'waiting')
    .select('id')
    .maybeSingle()

  if (!claimed) return

  await dispatchThrottled({
    orgId: job.org_id,
    sourceType: job.source_type,
    url: job.url,
    body: job.body,
  })

  await supabaseAdmin.from('pending_background_jobs').delete().eq('id', job.id)
}
