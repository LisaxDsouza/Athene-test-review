import type { AtheneStateType, AtheneStateUpdate } from "../langgraph/state";
import { vectorSearch } from "../tools/vector-search";

export async function retrievalAgent(state: AtheneStateType): Promise<AtheneStateUpdate> {
  const { org_id, user_id, user_role, messages } = state;

  const lastMessage = messages?.[messages.length - 1];
  const query =
    typeof lastMessage?.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? "");

  if (!query || !org_id) {
    return { run_status: "running" };
  }

  const results = await vectorSearch({
    orgId: org_id,
    userId: user_id,
    user_role: user_role ?? "member",
    query,
    topK: 8,
  });

  if (!results || results.length === 0) {
    return { run_status: "running" };
  }

  const retrieved_chunks = results.map((res: Record<string, unknown>) => ({
    id:              res.chunk_id as string ?? res.id as string,
    document_id:     res.document_id as string,
    content_preview: res.preview as string ?? res.content_preview as string ?? "",
    chunk_index:     res.chunk_index as number ?? 0,
    source_type:     res.source_type as string ?? "document",
    external_url:    res.external_url as string ?? null,
    department_id:   res.department_id as string ?? null,
    similarity:      res.score as number ?? res.similarity as number ?? 0,
  }));

  return { retrieved_chunks };
}
