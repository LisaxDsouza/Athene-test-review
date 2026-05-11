// ============================================================
// knowledge-graph/builder.ts — Graph builder (ATH-60)
//
// Triggered after every indexing batch by the graph-build worker.
// For each document: loads chunks from document_embeddings, runs
// the entity extractor (ATH-58), then upserts nodes/edges (ATH-59).
//
// SHA-256 content-hash dedup: if a document's content_hash hasn't
// changed since the last extraction we skip it entirely.
//
// Runs asynchronously via QStash so it never blocks the main
// indexing flow (ATH-44 wires this in after index-delta completes).
// ============================================================

import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/server'
import { extractEntitiesAndRelations } from './extractor'
import { upsertNodes, upsertEdges, deleteByDocument } from './storage'
import { detectCommunities } from './community'
import type { RLSContext } from '@/lib/supabase/rls-client'

// ---- Types --------------------------------------------------

export type BuildMode = 'incremental' | 'full'

export interface BuildResult {
  processedDocs: number
  skippedDocs: number
  totalNodes: number
  totalEdges: number
  errors: string[]
}

// ---- Core builder -------------------------------------------

/**
 * Build or update the knowledge graph for the given documents.
 *
 * @param orgId       - The organization to build for.
 * @param documentIds - Specific document IDs to process (incremental).
 *                      Pass empty array for full rebuild (caller must set mode='full').
 * @param mode        - 'incremental' processes only given IDs;
 *                      'full' queries all doc IDs for the org.
 */
export async function buildGraphForDocuments(
  orgId: string,
  documentIds: string[],
  mode: BuildMode = 'incremental',
): Promise<BuildResult> {
  const result: BuildResult = {
    processedDocs: 0,
    skippedDocs: 0,
    totalNodes: 0,
    totalEdges: 0,
    errors: [],
  }

  // ── Resolve the full list of docs to process ──────────────
  let docIds = documentIds

  if (mode === 'full') {
    const { data: allDocs, error } = await supabaseAdmin
      .from('documents')
      .select('id')
      .eq('org_id', orgId)

    if (error) throw new Error(`[builder] Failed to list documents: ${error.message}`)
    docIds = (allDocs ?? []).map((d: { id: string }) => d.id)
  }

  if (docIds.length === 0) return result

  // ── Process each document ─────────────────────────────────
  for (const docId of docIds) {
    try {
      const processed = await processDocument(orgId, docId, result)
      if (processed) result.processedDocs++
      else result.skippedDocs++
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[builder] Error processing doc ${docId}:`, msg)
      result.errors.push(`${docId}: ${msg}`)
    }
  }

  // ── Community detection pass ──────────────────────────────
  // After all docs processed, assign community IDs to connected nodes.
  if (result.processedDocs > 0) {
    try {
      await detectCommunities(orgId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[builder] Community detection failed:', msg)
      result.errors.push(`community: ${msg}`)
    }
  }

  return result
}

// ---- Per-document processing --------------------------------

async function processDocument(
  orgId: string,
  docId: string,
  result: BuildResult,
): Promise<boolean> {
  // 1. Load the document metadata for content_hash dedup check
  const { data: doc, error: docErr } = await supabaseAdmin
    .from('documents')
    .select('id, content_hash, last_extracted_hash, department_id, visibility')
    .eq('id', docId)
    .eq('org_id', orgId)
    .single()

  if (docErr || !doc) {
    throw new Error(`Document not found: ${docId}`)
  }

  // 2. SHA-256 skip: if content_hash unchanged since last extraction, skip
  if (doc.content_hash && doc.last_extracted_hash === doc.content_hash) {
    return false // skipped
  }

  // 3. Load all chunks from document_embeddings (content is in RAM, not stored)
  const { data: chunks, error: chunkErr } = await supabaseAdmin
    .from('document_embeddings')
    .select('id, metadata, chunk_index')
    .eq('document_id', docId)
    .eq('org_id', orgId)
    .order('chunk_index', { ascending: true })

  if (chunkErr) throw new Error(`Failed to load chunks: ${chunkErr.message}`)
  if (!chunks || chunks.length === 0) return false

  // 4. Build RLS context for storage writes
  // Graph builder runs as a background service — uses service-role context
  const ctx: RLSContext = {
    org_id: orgId,
    user_id: 'system',
    user_role: 'admin',
  }

  // 5. Delete existing graph contributions from this document
  //    (stale nodes/edges removed before re-extraction)
  await deleteByDocument(ctx, docId)

  // 6. Run entity/relation extraction
  //    extractor.ts expects chunks with { text, chunk_index, org_id, document_id, department_id, visibility }
  const extractorChunks = (chunks ?? []).map((c: any) => ({
    text: c.metadata?.text_preview ?? '', // extractor uses text; chunks store a preview in metadata
    chunk_index: c.chunk_index ?? 0,
    org_id: orgId,
    document_id: docId,
    department_id: doc.department_id ?? undefined,
    visibility: (doc.visibility ?? 'department') as 'public' | 'department' | 'private',
  }))

  const { nodes, edges } = await extractEntitiesAndRelations(extractorChunks)

  if (nodes.length === 0 && edges.length === 0) {
    // Still update the hash so we skip next time
    await markExtracted(orgId, docId, doc.content_hash)
    return true
  }

  // 7. Upsert nodes and edges into the graph
  const nodeIdMap = await upsertNodes(ctx, nodes)
  await upsertEdges(ctx, edges, nodeIdMap)

  result.totalNodes += nodes.length
  result.totalEdges += edges.length

  // 8. Mark document as extracted with the current content_hash
  await markExtracted(orgId, docId, doc.content_hash)

  return true
}

// ---- Hash stamp ---------------------------------------------

async function markExtracted(
  orgId: string,
  docId: string,
  contentHash: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('documents')
    .update({ last_extracted_hash: contentHash })
    .eq('id', docId)
    .eq('org_id', orgId)

  if (error) {
    console.error(`[builder] Failed to mark extracted for ${docId}:`, error.message)
  }
}
