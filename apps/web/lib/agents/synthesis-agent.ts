import { SystemMessage } from "@langchain/core/messages";
import type { MessageContentComplex } from "@langchain/core/messages";
import type {
  AtheneStateType,
  AtheneStateUpdate,
  CitedSource,
  RetrievedChunk,
} from "../langgraph/state";
import { resolveModelClient } from "../langgraph/llm-factory";
import { SYNTHESIS_PROMPTS } from "./prompts/index";

const REFUSAL = "I don't have enough info in your connected sources.";

/**
 * Groups chunks by community_id then renders context.
 * Chunks without a community are placed in a default group.
 * Community grouping helps the LLM reason about related facts together.
 */
function toContext(chunks: RetrievedChunk[]): string {
  const groups = new Map<string, RetrievedChunk[]>();

  for (const chunk of chunks) {
    const key = chunk.community_id ?? "__default__";
    const group = groups.get(key) ?? [];
    group.push(chunk);
    groups.set(key, group);
  }

  const sections: string[] = [];
  for (const [communityId, group] of groups) {
    const header =
      communityId === "__default__"
        ? ""
        : `### Community: ${communityId}\n`;
    const body = group
      .map((c) => `[${c.document_id}]\n${c.content_preview}`)
      .join("\n\n---\n\n");
    sections.push(header + body);
  }

  return sections.join("\n\n===\n\n");
}

function parseText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as MessageContentComplex[])
      .map((part) =>
        typeof part === "string"
          ? part
          : ((part as { text?: string }).text ?? ""),
      )
      .join("");
  }
  return "";
}

function extractCitations(answer: string, chunks: RetrievedChunk[]): CitedSource[] {
  const ids = Array.from(
    new Set([...answer.matchAll(/\[([a-zA-Z0-9_-]+)\]/g)].map((m) => m[1])),
  );
  return ids.flatMap((id) => {
    const chunk = chunks.find((c) => c.document_id === id);
    if (!chunk) return [];
    return [
      {
        document_id: chunk.document_id,
        title: null,
        external_url: chunk.external_url,
        chunk_index: chunk.chunk_index,
        source_type: chunk.source_type,
      },
    ];
  });
}

export async function synthesisAgentNode(
  state: AtheneStateType,
): Promise<AtheneStateUpdate> {
  const chunks = state.retrieved_chunks ?? [];
  if (chunks.length === 0) {
    return { final_answer: REFUSAL, cited_sources: [], retrieved_chunks: [] };
  }

  // Override mode to cross_dept_bi for BI queries regardless of what client sent
  const effectiveMode =
    state.is_cross_dept_query || state.task_type === "cross_dept_retrieval"
      ? "cross_dept_bi"
      : (state.response_mode ?? "chat");

  const promptTemplate = SYNTHESIS_PROMPTS[effectiveMode];
  const prompt = promptTemplate.replace("{{CONTEXT}}", toContext(chunks));

  const { client } = await resolveModelClient(
    state.org_id,
    state.complexity ?? "simple",
    "medium",
  );
  const response = await client.invoke([
    new SystemMessage(prompt),
    ...state.messages,
  ]);
  const finalAnswer = parseText(response.content).trim() || REFUSAL;

  return {
    final_answer: finalAnswer,
    cited_sources: extractCitations(finalAnswer, chunks),
    retrieved_chunks: [],
    response_mode: effectiveMode,
  };
}
