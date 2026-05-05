import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishJSON = vi.fn(async () => ({ messageId: 'msg-1' }))
const verifyMock = vi.fn(async () => true)
const incrWithExpire = vi.fn(async () => 1)
const decr = vi.fn(async () => 0)
const insert = vi.fn(async () => ({ error: null }))
const selectChain = {
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn(async () => ({ data: [] })),
}
const updateChain = {
  eq: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(async () => ({ data: null })),
}
const deleteChain = { eq: vi.fn(async () => ({ error: null })) }

vi.mock('@upstash/qstash', () => ({
  Client: vi.fn(function ClientMock() { return { publishJSON } }),
  Receiver: vi.fn(function ReceiverMock() { return { verify: verifyMock } }),
}))

vi.mock('@/lib/redis/client', () => ({
  incrWithExpire,
  redis: { decr },
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: () => ({
      insert,
      select: () => selectChain,
      update: () => updateChain,
      delete: () => deleteChain,
    }),
  },
}))

describe('qstash throttling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('first 3 dispatches succeed', async () => {
    incrWithExpire.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3)
    const { dispatchThrottled } = await import('@/lib/qstash/client')

    const a = await dispatchThrottled({ orgId: 'o1', sourceType: 'jira', url: 'https://x', body: {} })
    const b = await dispatchThrottled({ orgId: 'o1', sourceType: 'jira', url: 'https://x', body: {} })
    const c = await dispatchThrottled({ orgId: 'o1', sourceType: 'jira', url: 'https://x', body: {} })

    expect(a.dispatched && b.dispatched && c.dispatched).toBe(true)
    expect(publishJSON).toHaveBeenCalledTimes(3)
  })

  it('4th dispatch is throttled and queued', async () => {
    incrWithExpire.mockResolvedValue(4)
    const { dispatchThrottled } = await import('@/lib/qstash/client')

    const r = await dispatchThrottled({ orgId: 'o1', sourceType: 'jira', url: 'https://x', body: {} })
    expect(r.dispatched).toBe(false)
    expect(insert).toHaveBeenCalled()
    expect(decr).toHaveBeenCalled()
  })

  it('verifyQStashSignature rejects bad signatures', async () => {
    verifyMock.mockRejectedValueOnce(new Error('bad'))
    const { verifyQStashSignature } = await import('@/lib/qstash/verify')

    const req = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: { 'upstash-signature': 'bad' },
      body: JSON.stringify({ ok: true }),
    })
    const ok = await verifyQStashSignature(req)
    expect(ok).toBe(false)
  })
})
