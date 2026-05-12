import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { RLSContext } from "@/lib/supabase/rls-client";

export interface KGQueryResult {
  node_id: string;
  label: string;
  type: string;
  properties: Record<string, unknown>;
  depth: number;
}

/**
 * BFS graph traversal starting from a known node.
 * Only follows edges visible to the user (public edges + member check).
 * BI Analysts and admins see all edges.
 */
export async function traverseFromNode(
  nodeId: string,
  ctx: RLSContext,
  depth: number = 2,
): Promise<KGQueryResult[]> {
  const supabase = createSupabaseServiceClient();
  const visited = new Map<string, KGQueryResult>();
  const queue: Array<{ id: string; d: number }> = [{ id: nodeId, d: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.d > depth || visited.has(current.id)) continue;

    const { data: node } = await supabase
      .from("kg_nodes")
      .select("id, label, type, properties")
      .eq("id", current.id)
      .eq("org_id", ctx.org_id)
      .single();

    if (!node) continue;
    visited.set(current.id, { ...node, depth: current.d });

    if (current.d < depth) {
      let edgeQuery = supabase
        .from("kg_edges")
        .select("to_node_id, visibility")
        .eq("org_id", ctx.org_id)
        .eq("from_node_id", current.id);

      // Members only see public edges; analysts/admins see all
      if (ctx.user_role === "member") {
        edgeQuery = edgeQuery.eq("visibility", "public");
      }

      const { data: edges } = await edgeQuery;
      for (const edge of edges ?? []) {
        if (!visited.has(edge.to_node_id)) {
          queue.push({ id: edge.to_node_id, d: current.d + 1 });
        }
      }
    }
  }

  return Array.from(visited.values());
}

/**
 * Semantic node search via `kg_node_search` RPC (pgvector cosine similarity).
 * Falls back to ilike label search when no embedding is provided.
 */
export async function searchNodes(
  orgId: string,
  query: string,
  limit: number = 10,
  queryEmbedding?: number[],
): Promise<KGQueryResult[]> {
  const supabase = createSupabaseServiceClient();

  if (queryEmbedding && queryEmbedding.length > 0) {
    const { data, error } = await supabase.rpc("kg_node_search", {
      p_org_id: orgId,
      p_embedding: queryEmbedding,
      p_limit: limit,
    });

    if (!error && data) {
      return (data as Array<Record<string, unknown>>).map((row) => ({
        node_id:    row.id as string,
        label:      row.label as string,
        type:       row.type as string,
        properties: (row.properties as Record<string, unknown>) ?? {},
        depth:      0,
      }));
    }
  }

  // ilike fallback
  const { data } = await supabase
    .from("kg_nodes")
    .select("id, label, type, properties")
    .eq("org_id", orgId)
    .ilike("label", `%${query}%`)
    .limit(limit);

  return (data ?? []).map((row) => ({
    node_id:    row.id,
    label:      row.label,
    type:       row.type,
    properties: row.properties ?? {},
    depth:      0,
  }));
}
