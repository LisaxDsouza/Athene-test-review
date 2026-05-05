import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'

const invokeMock = vi.hoisted(() => vi.fn())
const readFileSyncMock = vi.hoisted(() => vi.fn())

vi.mock('../../langgraph/llm-factory', () => ({
  resolveModelClient: vi.fn(async () => ({ client: { invoke: invokeMock } })),
}))

vi.mock('fs', () => ({
  readFileSync: readFileSyncMock,
}))

import { synthesisAgentNode } from '../synthesis-agent'
import type { AtheneStateType } from '../../langgraph/state'

function makeState(overrides: Partial<AtheneStateType> = {}): AtheneStateType {
  return {
    thread_id: 't1',
    org_id: 'o1',
    user_id: 'u1',
    user_role: 'member',
    user_dept_id: null,
    accessible_dept_ids: [],
    bi_grant_id: null,
    messages: [new HumanMessage('question')],
    active_agent: null,
    next: 'FINISH',
    task_type: 'document_search',
    complexity: 'simple',
    is_cross_dept_query: false,
    retrieved_chunks: [],
    hop_count: 0,
    reasoning: '',
    pending_tool_calls: [],
    run_status: 'idle',
    awaiting_approval: false,
    pending_write_action: null,
    final_answer: null,
    cited_sources: [],
    ...overrides,
  }
}

describe('synthesisAgentNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readFileSyncMock.mockReturnValue('Mode {{MODE}}\n{{CONTEXT}}')
  })

  it('happy path with citation extraction', async () => {
    invokeMock.mockResolvedValue({ content: 'Revenue up [doc_a].' })
    const result = await synthesisAgentNode(
      makeState({
        retrieved_chunks: [{ document_id: 'doc_a', content_preview: 'Revenue up', chunk_index: 0, source_type: 'slack' }],
      }),
    )

    expect(result.final_answer).toBe('Revenue up [doc_a].')
    expect(result.cited_sources).toHaveLength(1)
    expect(result.retrieved_chunks).toEqual([])
  })

  it('empty chunks refuses without llm call', async () => {
    const result = await synthesisAgentNode(makeState({ retrieved_chunks: [] }))
    expect(result.final_answer).toBe("I don't have enough info in your connected sources.")
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('hallucination prevention keeps only known citations', async () => {
    invokeMock.mockResolvedValue({ content: 'Unknown [doc_x].' })
    const result = await synthesisAgentNode(
      makeState({
        retrieved_chunks: [{ document_id: 'doc_a', content_preview: 'Revenue up', chunk_index: 0, source_type: 'slack' }],
      }),
    )
    expect(result.cited_sources).toHaveLength(0)
  })
})
