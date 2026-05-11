import type { AtheneStateType, AtheneStateUpdate } from "../langgraph/state";
import { vectorSearch } from "../tools/vector-search";
import { searchNodes, traverseFromNode } from "../knowledge-graph/query";
import type { RLSContext } from "../supabase/rls-client";
import type { GraphNode, GraphEdge } from "../knowledge-graph/query";

function buildRLSContext(state: AtheneStateType): RLSContext {
  return {
    org_id: state.org_id,
    user_id: state.user_id,
    user_role: state.user_role || "member",
    department_id: state.user_dept_id ?? undefined,
    grant_ids: (state as any).grant_ids || [], // Future-proof for BI Grants UI
  };
}

function formatGraphContext(
  nodes: GraphNode[],
  edges: GraphEdge[]
): string {
  if (nodes.length === 0) return "";

  const nodeList = nodes
    .map((n) => `${n.label} (${n.entity_type})${n.description ? `: ${n.description}` : ""}`)
    .join("\n  - ");

  if (edges.length === 0) return `Entities:\n  - ${nodeList}`;

  const edgeList = edges
    .map((e) => `${e.source_node} → ${e.relation} → ${e.target_node} [${e.provenance}]`)
    .join("\n  - ");

  return `Entities:\n  - ${nodeList}\n\nRelationships:\n  - ${edgeList}`;
}

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

  const ctx = buildRLSContext(state);

  // PARALLEL: vector search + graph entity search
  const [vectorResults, graphNodeResult] = await Promise.all([
    vectorSearch({
      orgId: org_id,
      userId: user_id,
      user_role: (user_role || "member") as any,
      query,
      topK: 8,
    }).catch(() => []),

    searchNodes(ctx, query, 5).catch(() => ({
      nodes: [],
      edges: [],
      boundary_reached: false,
    })),
  ]);

  // Graph traversal from the most relevant node (if any found)
  let graphTraversalResult = { nodes: [] as GraphNode[], edges: [] as GraphEdge[], boundary_reached: false };
  if (graphNodeResult.nodes.length > 0) {
    const seedNode = graphNodeResult.nodes[0];
    if (seedNode.id) {
      graphTraversalResult = await traverseFromNode(ctx, seedNode.id, { maxHops: 2 }).catch(
        () => ({ nodes: graphNodeResult.nodes, edges: [], boundary_reached: false })
      );
    } else {
      graphTraversalResult = { nodes: graphNodeResult.nodes, edges: [], boundary_reached: false };
    }
  }

  const allNodes = graphTraversalResult.nodes;
  const allEdges = graphTraversalResult.edges;
  const graphContext = formatGraphContext(allNodes, allEdges);

  const retrieved_chunks = (vectorResults ?? []).map((res: Record<string, unknown>) => ({
    id:              (res.chunk_id as string) ?? (res.id as string),
    document_id:     res.document_id as string,
    content_preview: (res.preview as string) ?? (res.content_preview as string) ?? "",
    chunk_index:     (res.chunk_index as number) ?? 0,
    source_type:     (res.source_type as string) ?? "document",
    external_url:    (res.external_url as string) ?? null,
    department_id:   (res.department_id as string) ?? null,
    similarity:      (res.score as number) ?? (res.similarity as number) ?? 0,
  }));

  return {
    retrieved_chunks,
    graph_context: graphContext || null,
    graph_boundary_reached: graphTraversalResult.boundary_reached,
  };
}
