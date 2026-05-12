import { SystemMessage } from '@langchain/core/messages'
import type { MessageContentComplex } from '@langchain/core/messages'
import type {
  AtheneStateType,
  AtheneStateUpdate,
  CitedSource,
  RetrievedChunk,
} from '../langgraph/state'
import { resolveModelClient } from '../langgraph/llm-factory'
import { SYNTHESIS_PROMPT } from './prompts/index'

const REFUSAL = "I don't have enough info in your connected sources."

function toContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => `[${c.document_id}]\n${c.content_preview}`)
    .join('\n\n---\n\n')
}

function parseText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as MessageContentComplex[])
      .map((part) =>
        typeof part === 'string'
          ? part
          : ((part as { text?: string }).text ?? ''),
      )
      .join('')
  }
  return ''
}

function extractCitations(answer: string, chunks: RetrievedChunk[]): CitedSource[] {
  const ids = Array.from(new Set([...answer.matchAll(/\[([a-zA-Z0-9_-]+)\]/g)].map((m) => m[1])))
  return ids.flatMap((id) => {
    const chunk = chunks.find((c) => c.document_id === id)
    if (!chunk) return []
    return [
      {
        document_id: chunk.document_id,
        title: null,
        external_url: chunk.external_url,
        chunk_index: chunk.chunk_index,
        source_type: chunk.source_type,
      },
    ]
  })
}

export async function synthesisAgentNode(state: AtheneStateType): Promise<AtheneStateUpdate> {
  const chunks = state.retrieved_chunks ?? []
  const graphContext = state.graph_context ?? null
  const graphBoundaryReached = state.graph_boundary_reached ?? false

  if (chunks.length === 0 && !graphContext) {
    return {
      final_answer: REFUSAL,
      cited_sources: [],
      retrieved_chunks: [],
      graph_context: null,
      graph_boundary_reached: false,
    }
  }

  const mode = state.is_cross_dept_query || state.task_type === 'cross_dept_retrieval' ? 'BI' : 'STANDARD'

  const chunkSection = chunks.length > 0 ? toContext(chunks) : '(no document chunks retrieved)'
  const graphSection = graphContext
    ? `\n\n---\nKnowledge Graph Context:\n${graphContext}`
    : ''
  const boundaryNote = graphBoundaryReached
    ? '\n\n*Note: some related information may exist in areas you do not have access to.*'
    : ''

  const prompt = SYNTHESIS_PROMPT
    .replace('{{MODE}}', mode)
    .replace('{{CONTEXT}}', chunkSection + graphSection)

  const { client } = await resolveModelClient(state.org_id, state.complexity ?? 'simple', 'medium')
  const response = await client.invoke([new SystemMessage(prompt), ...state.messages])
  const finalAnswer = (parseText(response.content).trim() || REFUSAL) + boundaryNote

  return {
    final_answer: finalAnswer,
    cited_sources: extractCitations(finalAnswer, chunks),
    retrieved_chunks: [],
    graph_context: null,
    graph_boundary_reached: false,
  }
}
