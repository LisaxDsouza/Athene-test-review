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

  console.log("[retrieval-agent] Starting vector search for query:", query);
  console.log("[retrieval-agent] OPENAI_API_KEY present:", !!process.env.OPENAI_API_KEY);

  try {
    console.log("[retrieval-agent] Calling embed...");
    const results = await Promise.race([
      vectorSearch({
        orgId: org_id,
        userId: user_id,
        user_role: user_role ?? "member",
        query,
        topK: 8,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("vectorSearch timed out after 15s")), 15000)
      ),
    ]) as Awaited<ReturnType<typeof vectorSearch>>;

    console.log("[retrieval-agent] Vector search returned:", results?.length ?? 0, "results");

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

  } catch (err) {
    console.error("[retrieval-agent] Error:", err instanceof Error ? err.message : err);
    return { retrieved_chunks: [], run_status: "running" };
  }
}