import type { AtheneStateType, AtheneStateUpdate } from "../langgraph/state";
import { vectorSearch } from "../tools/vector-search";
import { fetchByokKey } from "../langgraph/llm-factory";

/** Minimum cosine similarity to include a chunk. Below this is noise. */
const SIMILARITY_THRESHOLD = 0.55;

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

  const byok = await fetchByokKey(org_id);
  const apiKey = byok?.provider === "openai" ? byok.plaintext : undefined;

  try {
    const results = await Promise.race([
      vectorSearch({
        orgId: org_id,
        userId: user_id,
        user_role: user_role ?? "member",
        query,
        topK: 12,
        apiKey,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("vectorSearch timed out after 15s")), 15000),
      ),
    ]) as Awaited<ReturnType<typeof vectorSearch>>;

    console.log("[retrieval-agent] Vector search returned:", results?.length ?? 0, "results");

    if (!results || results.length === 0) {
      return { retrieved_chunks: [], run_status: "running" };
    }

    // Dedup on document_id:chunk_index, apply similarity threshold
    const seen = new Set<string>();
    const communityIds = new Set<string>();
    const retrieved_chunks: AtheneStateUpdate["retrieved_chunks"] = [];

    for (const res of results as Record<string, unknown>[]) {
      const similarity = (res.score as number) ?? (res.similarity as number) ?? 0;
      if (similarity < SIMILARITY_THRESHOLD) continue;

      const docId = res.document_id as string;
      const chunkIndex = (res.chunk_index as number) ?? 0;
      const dedupKey = `${docId}:${chunkIndex}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const communityId = (res.community_id as string) ?? null;
      if (communityId) communityIds.add(communityId);

      retrieved_chunks.push({
        id:              (res.chunk_id as string) ?? (res.id as string),
        document_id:     docId,
        content_preview: (res.preview as string) ?? (res.content_preview as string) ?? "",
        chunk_index:     chunkIndex,
        source_type:     (res.source_type as string) ?? "document",
        external_url:    (res.external_url as string) ?? null,
        department_id:   (res.department_id as string) ?? null,
        similarity,
        community_id:    communityId,
      });
    }

    if (retrieved_chunks.length === 0) {
      return { retrieved_chunks: [], run_status: "running" };
    }

    return {
      retrieved_chunks,
      community_ids: Array.from(communityIds),
    };

  } catch (err) {
    console.error("[retrieval-agent] Error:", err instanceof Error ? err.message : err);
    return { retrieved_chunks: [], run_status: "running" };
  }
}
