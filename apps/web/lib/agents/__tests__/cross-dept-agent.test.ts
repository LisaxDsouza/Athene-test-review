// ============================================================
// cross-dept-agent.test.ts — ATH-35 unit tests
//
// Verifies:
//   1. Hard role check rejects non-bi_analysts immediately
//   2. bi_analyst role invokes the cross-dept tool
//   3. Audit rows always written (even on 0 results)
//   4. Audit write failures don't bubble up
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AtheneStateType } from '@/lib/langgraph/state'

// ---- Mock ToolNode ------------------------------------------

const mockToolNodeInvoke = vi.fn()

vi.mock('@langchain/langgraph/prebuilt', () => ({
  ToolNode: class FakeToolNode {
    constructor(public tools: any[]) {}
    invoke = mockToolNodeInvoke
  },
}))

// ---- Mock tool registry -------------------------------------

vi.mock('@/lib/langgraph/tools/registry', () => ({
  crossDeptVectorSearchTool: { name: 'cross_dept_vector_search' },
  toolsRegistry: [],
  registerTool: vi.fn(),
}))

// ---- Mock supabaseAdmin -------------------------------------

const mockInsert = vi.fn()
const mockFromAudit = vi.fn(() => ({ insert: mockInsert }))
mockInsert.mockResolvedValue({ error: null })

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: { from: mockFromAudit },
}))

// ---- Import after mocks ------------------------------------

import { crossDeptAgent } from '@/lib/agents/cross-dept-agent'

// ---- Helpers ------------------------------------------------

function makeState(
  role: string,
  messages: any[] = [],
): AtheneStateType {
  return {
    orgId: 'org-test',
    userId: 'user-test',
    role,
    messages: messages.length > 0
      ? messages
      : [{ role: 'user', content: 'Show me cross-dept trends' }],
    retrievedDocs: [],
  } as any
}

// ---- Tests --------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockInsert.mockResolvedValue({ error: null })
})

describe('crossDeptAgent — role guard', () => {
  it('rejects non-bi_analyst with Access Denied message', async () => {
    const result = await crossDeptAgent(makeState('member'), {})

    expect(result.messages).toBeDefined()
    expect(result.messages![0]).toMatchObject({
      role: 'assistant',
      content: expect.stringContaining('Access Denied'),
    })
    // Tool should never be invoked
    expect(mockToolNodeInvoke).not.toHaveBeenCalled()
  })

  it('rejects admin role with Access Denied', async () => {
    const result = await crossDeptAgent(makeState('admin'), {})
    expect(result.messages![0].content).toContain('Access Denied')
  })

  it('rejects empty string role', async () => {
    const result = await crossDeptAgent(makeState(''), {})
    expect(result.messages![0].content).toContain('Access Denied')
  })
})

describe('crossDeptAgent — bi_analyst path', () => {
  beforeEach(() => {
    // Tool returns one doc
    mockToolNodeInvoke.mockResolvedValue({
      messages: [
        {
          _getType: () => 'tool',
          content: JSON.stringify([
            {
              chunk_id: 'chunk-1',
              metadata: { department_id: 'finance' },
            },
          ]),
        },
      ],
    })
  })

  it('invokes tool node and returns messages', async () => {
    const result = await crossDeptAgent(makeState('bi_analyst'), {})

    expect(mockToolNodeInvoke).toHaveBeenCalledOnce()
    expect(result.messages).toBeDefined()
  })

  it('passes orgId, userId, role into tool config metadata', async () => {
    await crossDeptAgent(makeState('bi_analyst'), { metadata: {} })

    const callArg = mockToolNodeInvoke.mock.calls[0][1]
    expect(callArg.metadata).toMatchObject({
      orgId: 'org-test',
      userId: 'user-test',
      role: 'bi_analyst',
    })
  })

  it('sets retrievedDocs from parsed tool messages', async () => {
    const result = await crossDeptAgent(makeState('bi_analyst'), {})

    expect(result.retrievedDocs).toHaveLength(1)
    expect((result.retrievedDocs as any[])[0].chunk_id).toBe('chunk-1')
  })
})

describe('crossDeptAgent — audit logging', () => {
  it('writes audit row when docs retrieved', async () => {
    mockToolNodeInvoke.mockResolvedValue({
      messages: [
        {
          _getType: () => 'tool',
          content: JSON.stringify([
            { chunk_id: 'c-1', metadata: { department_id: 'eng' } },
            { chunk_id: 'c-2', metadata: { department_id: 'finance' } },
          ]),
        },
      ],
    })

    await crossDeptAgent(makeState('bi_analyst'), {})

    expect(mockFromAudit).toHaveBeenCalledWith('bi_access_audit')
    const insertArg = mockInsert.mock.calls[0][0] as any[]
    expect(insertArg).toHaveLength(2)
    expect(insertArg[0]).toMatchObject({ org_id: 'org-test', doc_id: 'c-1', dept: 'eng' })
    expect(insertArg[1]).toMatchObject({ org_id: 'org-test', doc_id: 'c-2', dept: 'finance' })
  })

  it('writes single null-doc audit row when 0 docs returned', async () => {
    mockToolNodeInvoke.mockResolvedValue({ messages: [] })

    await crossDeptAgent(makeState('bi_analyst'), {})

    expect(mockFromAudit).toHaveBeenCalledWith('bi_access_audit')
    const insertArg = mockInsert.mock.calls[0][0] as any[]
    expect(insertArg).toHaveLength(1)
    expect(insertArg[0]).toMatchObject({
      org_id: 'org-test',
      user_id: 'user-test',
      doc_id: null,
      dept: null,
    })
  })

  it('audit failure does not bubble up', async () => {
    mockToolNodeInvoke.mockResolvedValue({ messages: [] })
    mockInsert.mockResolvedValue({ error: { message: 'DB error' } })

    // Should resolve without throwing
    await expect(
      crossDeptAgent(makeState('bi_analyst'), {}),
    ).resolves.toBeDefined()
  })

  it('extracts query text from last human message', async () => {
    mockToolNodeInvoke.mockResolvedValue({ messages: [] })

    await crossDeptAgent(
      makeState('bi_analyst', [
        { role: 'user', content: 'what are the finance trends?' },
      ]),
      {},
    )

    const insertArg = mockInsert.mock.calls[0][0] as any[]
    expect(insertArg[0].query).toBe('what are the finance trends?')
  })
})
