import OpenAI from "openai";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { extractKGFromChunk } from "./extractor";
import type { ExtractorChunk, KGNode, KGEdge } from "./types";

/**
 * Builds and upserts a knowledge graph for a single document.
 * Processes chunks sequentially to avoid rate-limit bursts.
 */
export async function buildKGForDocument(
  orgId: string,
  documentId: string,
  sourceType: string,
  chunks: Array<{ content: string; chunk_index: number }>,
  anthropicKey: string,
  openaiKey?: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const allNodes: KGNode[] = [];
  const allEdges: KGEdge[] = [];

  for (const chunk of chunks) {
    const extraction = await extractKGFromChunk(
      { content: chunk.content, document_id: documentId, chunk_index: chunk.chunk_index, source_type: sourceType },
      anthropicKey,
    );

    for (const n of extraction.nodes) {
      allNodes.push({
        id: n.id,
        org_id: orgId,
        label: n.label,
        type: n.type,
        properties: n.properties ?? {},
        source_document_id: documentId,
        source_type: sourceType,
        description_embedding: null,
      });
    }

    for (const edge of extraction.edges) {
      allEdges.push({
        org_id: orgId,
        from_node_id: edge.from,
        to_node_id: edge.to,
        relation: edge.relation,
        weight: edge.weight ?? 0.8,
        visibility: "public",
      });
    }
  }

  if (allNodes.length === 0) return;

  // Upsert nodes (id + org_id is the unique key)
  const { error: nodeError } = await supabase
    .from("kg_nodes")
    .upsert(allNodes.map(({ description_embedding: _ignored, ...n }) => n), {
      onConflict: "id,org_id",
    });
  if (nodeError) console.error("[kg-builder] Node upsert error:", nodeError.message);

  // Embed node labels for semantic search (best-effort)
  if (openaiKey) {
    await embedNodeDescriptions(orgId, allNodes, openaiKey);
  }

  // Upsert edges
  if (allEdges.length > 0) {
    const { error: edgeError } = await supabase.from("kg_edges").upsert(allEdges, {
      onConflict: "org_id,from_node_id,to_node_id,relation",
    });
    if (edgeError) console.error("[kg-builder] Edge upsert error:", edgeError.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function embedNodeDescriptions(
  orgId: string,
  nodes: KGNode[],
  openaiKey: string,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const openai = new OpenAI({ apiKey: openaiKey });

  const BATCH = 64;
  for (let i = 0; i < nodes.length; i += BATCH) {
    const batch = nodes.slice(i, i + BATCH);
    const inputs = batch.map((n) => `${n.type}: ${n.label}`);

    try {
      const res = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: inputs,
      });

      const updates = batch.map((n, idx) => ({
        id: n.id,
        org_id: orgId,
        description_embedding: res.data[idx].embedding,
      }));

      for (const upd of updates) {
        await supabase
          .from("kg_nodes")
          .update({ description_embedding: upd.description_embedding })
          .eq("id", upd.id)
          .eq("org_id", upd.org_id);
      }
    } catch (err) {
      console.error("[kg-builder] Embedding batch failed:", err instanceof Error ? err.message : err);
    }
  }
}
