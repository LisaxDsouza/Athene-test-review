import { readFileSync } from 'fs'
import { join } from 'path'
import { SystemMessage } from '@langchain/core/messages'
import type { MessageContentComplex } from '@langchain/core/messages'
import type {
  AtheneStateType,
  AtheneStateUpdate,
  CitedSource,
  RetrievedChunk,
} from '../langgraph/state'
import { resolveModelClient } from '../langgraph/llm-factory'

const REFUSAL = "I don't have enough info in your connected sources."

function loadPromptTemplate(): string {
  const promptPath = join(process.cwd(), 'lib/agents/prompts/synthesis.md')
  try {
    return readFileSync(promptPath, 'utf8')
  } catch {
    throw new Error('Synthesis prompt file missing')
  }
}

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
  if (chunks.length === 0) {
    return { final_answer: REFUSAL, cited_sources: [], retrieved_chunks: [] }
  }

  const mode = state.is_cross_dept_query || state.task_type === 'cross_dept_retrieval' ? 'BI' : 'STANDARD'
  const prompt = loadPromptTemplate()
    .replace('{{MODE}}', mode)
    .replace('{{CONTEXT}}', toContext(chunks))

  const { client } = await resolveModelClient(state.org_id, state.complexity ?? 'simple', 'medium')
  const response = await client.invoke([new SystemMessage(prompt), ...state.messages])
  const finalAnswer = parseText(response.content).trim() || REFUSAL

  return {
    final_answer: finalAnswer,
    cited_sources: extractCitations(finalAnswer, chunks),
    retrieved_chunks: [],
  }
}
