import OpenAI from "openai";
import { requireEnv } from "@/lib/env";
import { withRLS } from "@/lib/supabase/rls-client";

export type VectorHit = {
  chunk_id: string;
  dept_id: string | null;
  source_type: string;
  source_id: string;
  source_url: string;
  title: string;
  author: string | null;
  last_modified: string | null;
  visibility: string;
  score: number;
};

export async function embedQuery(query: string) {
  const openai = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  const result = await openai.embeddings.create({ model: "text-embedding-3-small", input: query });
  return result.data[0].embedding;
}

export async function vectorSearch(userId: string, orgId: string, query: string, limit = 8): Promise<VectorHit[]> {
  const embedding = await embedQuery(query);
  const ctx = { user_id: userId, org_id: orgId, user_role: 'member' };
  return withRLS(ctx, async (client) => {
    const { data, error } = await client.rpc("match_document_embeddings", {
      query_embedding: embedding,
      match_count: limit,
    });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      chunk_id: row.chunk_id,
      dept_id: row.dept_id,
      source_type: row.source_type,
      source_id: row.source_id,
      source_url: row.source_url,
      title: row.metadata?.title || row.source_id,
      author: row.metadata?.author || null,
      last_modified: row.metadata?.last_modified || null,
      visibility: row.visibility,
      score: Number(row.score ?? row.similarity ?? 0),
    }));
  });
}
