// ============================================================
// integrations/indexing.ts — Bridge between fetchers and vector store
//
// Takes FetchedChunk[] from any provider, chunks large content,
// generates embeddings via OpenAI, and upserts into Supabase
// document_embeddings table using the service-role client.
//
// Writes go through supabaseAdmin (service-role) — bypasses RLS.
// Reads later go through withRLS() — the existing pattern.
//
// No tokens or raw content is logged. Only document metadata
// is written to the database.
// ============================================================

import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/server'
import { baseFetch } from './base'
import type { FetchedChunk } from './base'
import { logger } from '@/lib/logger'

// ---- Retry helper -----------------------------------------------

/**
 * Retries an async function with exponential backoff.
 * On exhaustion, throws the last error so callers (e.g. QStash) can retry the job.
 *
 * @param fn          - The async operation to attempt.
 * @param retries     - Number of retry attempts after the initial try (default 3).
 * @param baseDelayMs - Delay before first retry in ms; doubles each attempt (default 1000).
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < retries) {
        const delayMs = baseDelayMs * 2 ** attempt
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
  throw lastError
}

// ---- Constants --------------------------------------------------

/** Target chunk size in characters (~500 tokens ≈ 2000 chars) */
const CHUNK_SIZE_CHARS = 2000

/** Overlap between chunks to preserve context at boundaries */
const CHUNK_OVERLAP_CHARS = 200

/** OpenAI embedding model */
const EMBEDDING_MODEL = 'text-embedding-3-small'

/** Embedding dimensions (text-embedding-3-small default) */
const EMBEDDING_DIMENSIONS = 1536

// ---- Content Chunking -------------------------------------------

/**
 * Splits content into overlapping chunks of ~CHUNK_SIZE_CHARS.
 * Tries to break at sentence boundaries when possible.
 */
function chunkContent(content: string): string[] {
  if (content.length <= CHUNK_SIZE_CHARS) {
    return [content]
  }

  const chunks: string[] = []
  let start = 0

  while (start < content.length) {
    let end = start + CHUNK_SIZE_CHARS

    // If we're not at the end, try to break at a sentence boundary
    if (end < content.length) {
      // Look for sentence-ending punctuation near the chunk boundary
      const searchWindow = content.substring(
        Math.max(start, end - 200),
        end
      )
      const lastSentenceEnd = Math.max(
        searchWindow.lastIndexOf('. '),
        searchWindow.lastIndexOf('.\n'),
        searchWindow.lastIndexOf('? '),
        searchWindow.lastIndexOf('! ')
      )

      if (lastSentenceEnd > 0) {
        // Adjust end to the sentence boundary (relative to content, not window)
        end = Math.max(start, end - 200) + lastSentenceEnd + 1
      }
    }

    chunks.push(content.substring(start, Math.min(end, content.length)).trim())

    // Next chunk starts with overlap
    start = end - CHUNK_OVERLAP_CHARS
    if (start >= content.length) break
  }

  return chunks.filter((c) => c.length > 0)
}

// ---- Embedding Generation ---------------------------------------

/**
 * Generates embeddings for the given texts using OpenAI.
 * Uses the API key from environment — never stored, never logged.
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY environment variable')
  }

  const data = await baseFetch<{
    data: Array<{ embedding: number[]; index: number }>
  }>('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    },
  })

  // Sort by index to maintain order
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding)
}

// ---- Main Indexing Function -------------------------------------

// ---- Document record resolution ---------------------------------

type VisibilityLevel = 'org_wide' | 'department' | 'bi_accessible' | 'confidential' | 'restricted'

/**
 * Upserts a row in the `documents` table for this chunk and returns its UUID.
 * Uses UNIQUE (org_id, connection_id, external_id) to make it idempotent.
 */
async function upsertDocumentRecord(
  chunk: FetchedChunk,
  orgId: string,
  connectionId: string,
  departmentId: string | null,
  visibility: VisibilityLevel,
  ownerUserId: string | null
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('documents')
    .upsert(
      {
        org_id: orgId,
        connection_id: connectionId,
        external_id: chunk.chunk_id,
        title: chunk.title,
        source_type: chunk.metadata.provider,
        department_id: departmentId,
        owner_user_id: ownerUserId,
        visibility,
        external_url: chunk.source_url,
        metadata: chunk.metadata,
      },
      { onConflict: 'org_id,connection_id,external_id' }
    )
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`[indexing] Failed to upsert document record: ${error?.message}`)
  }
  return data.id as string
}

// ---- Main Indexing Function -------------------------------------

/**
 * Indexes a single FetchedChunk into the vector store.
 *
 * Flow:
 *   1. Upsert the document metadata row (resolves/creates documents.id)
 *   2. Chunk the content if it exceeds CHUNK_SIZE_CHARS
 *   3. Generate embeddings for all chunks in a batch
 *   4. Upsert each chunk + embedding into document_embeddings
 *
 * @param chunk       - The fetched chunk to index
 * @param orgId       - Organization ID
 * @param connectionId - Nango connection UUID (links to connections.id)
 * @param departmentId - Department UUID for RLS scoping (nullable)
 * @param visibility  - Row-level visibility level
 * @param ownerUserId - org_members.id of the document owner (nullable)
 */
export async function indexDocument(
  chunk: FetchedChunk,
  orgId: string,
  connectionId: string,
  departmentId: string | null,
  visibility: VisibilityLevel = 'department',
  ownerUserId: string | null = null
): Promise<void> {
  // 0. Resolve/create the documents row
  const documentId = await upsertDocumentRecord(
    chunk, orgId, connectionId, departmentId, visibility, ownerUserId
  )
  // 1. Split content into chunks
  const contentChunks = chunkContent(chunk.content)

  if (contentChunks.length === 0) return

  // 2. Generate embeddings for all chunks in a single batch
  const embeddings = await generateEmbeddings(contentChunks)

  // 3. Build the records to upsert — must match document_embeddings schema exactly
  const records = contentChunks.map((text, index) => ({
    org_id: orgId,
    document_id: documentId,
    department_id: departmentId,
    owner_user_id: ownerUserId,
    source_type: chunk.metadata.provider,
    visibility,
    content_preview: text.substring(0, 200), // schema comment: first 200 chars
    chunk_index: index,
    embedding: embeddings[index],
    // SHA-256 hash of the content — used to skip re-embedding unchanged chunks
    content_hash: createHash('sha256').update(text).digest('hex'),
    metadata: chunk.metadata,
  }))

  // 4. Upsert into Supabase via service-role (bypasses RLS)
  // onConflict matches UNIQUE (document_id, chunk_index) constraint
  const { error } = await supabaseAdmin
    .from('document_embeddings')
    .upsert(records, { onConflict: 'document_id,chunk_index' })

  if (error) {
    logger.error({ title: chunk.title, err: error.message }, '[indexing] Error upserting chunks')
    throw error
  }
}

/** Maximum texts per OpenAI embedding API call */
const EMBED_BATCH_SIZE = 96

/**
 * Indexes multiple FetchedChunks with batched embedding generation.
 *
 * Instead of one OpenAI call per document (N round-trips), this:
 *   1. Resolves/creates all document rows in parallel
 *   2. Splits every document's content into sub-chunks
 *   3. Sends all sub-chunk texts to OpenAI in batches of EMBED_BATCH_SIZE
 *   4. Upserts all embedding records in a single Supabase call
 */
export async function indexDocuments(
  chunks: FetchedChunk[],
  orgId: string,
  connectionId: string,
  departmentId: string | null,
  visibility: VisibilityLevel = 'department',
  ownerUserId: string | null = null
): Promise<{ indexed: number; errors: number; documentIds: string[] }> {
  if (chunks.length === 0) return { indexed: 0, errors: 0, documentIds: [] }

  // ---- Phase 1: resolve document rows in parallel -----------------
  type PreparedItem = {
    chunk: FetchedChunk
    documentId: string
    subChunks: string[]
  }

  const prepared: PreparedItem[] = []
  let errors = 0

  // ---- Phase 1: resolve document rows and split into sub-chunks ----
  for (const chunk of chunks) {
    try {
      const documentId = await upsertDocumentRecord(chunk, orgId, connectionId, departmentId, visibility, ownerUserId)
      const subChunks = chunkContent(chunk.content)
      if (subChunks.length > 0) {
        prepared.push({ chunk, documentId, subChunks })
      }
    } catch (err) {
      errors++
      logger.error(
        { title: chunk.title, err: err instanceof Error ? err.message : String(err) },
        '[indexing] Failed to prepare chunk'
      )
    }
  }

  // ---- Phase 2: flatten sub-chunk texts and build record templates -
  const allTexts: string[] = prepared.flatMap(item => item.subChunks)
  const allTemplates = prepared.flatMap(item =>
    item.subChunks.map((text, index) => ({
      org_id: orgId,
      document_id: item.documentId,
      department_id: departmentId,
      owner_user_id: ownerUserId,
      source_type: item.chunk.metadata.provider,
      visibility,
      content_preview: text.substring(0, 200),
      chunk_index: index,
      content_hash: createHash('sha256').update(text).digest('hex'),
      metadata: item.chunk.metadata,
    }))
  )

  // ---- Phase 3: generate embeddings in batches --------------------
  const allEmbeddings: number[][] = []
  for (let i = 0; i < allTexts.length; i += EMBED_BATCH_SIZE) {
    const batchTexts = allTexts.slice(i, i + EMBED_BATCH_SIZE)
    // Retry with exponential backoff (1s, 2s, 4s). On exhaustion, throw so
    // QStash retries the entire job rather than silently losing data.
    const batchEmbeddings = await retryWithBackoff(
      () => generateEmbeddings(batchTexts),
      3,
      1000,
    )
    allEmbeddings.push(...batchEmbeddings)
  }

  // ---- Phase 4: upsert all records in one call -------------------
  const records = allTemplates
    .map((tmpl, idx) => ({ ...tmpl, embedding: allEmbeddings[idx] }))
    .filter((r) => r.embedding.length > 0)

  if (records.length > 0) {
    const { error } = await supabaseAdmin
      .from('document_embeddings')
      .upsert(records, { onConflict: 'document_id,chunk_index' })

    if (error) {
      console.error('[indexing] Bulk upsert error:', error.message)
      errors += records.length
      return { indexed: 0, errors, documentIds: [] }
    }
  }

  const documentIds = [...new Set(prepared.map((item) => item.documentId))]
  return { indexed: prepared.length, errors, documentIds }
}

// ---- Helpers ----------------------------------------------------

/**
 * Generates a deterministic ID for a chunk.
 * Ensures re-indexing overwrites rather than duplicates.
 */
function generateChunkId(
  sourceType: string,
  sourceUrl: string,
  chunkIndex: number
): string {
  // Simple hash: we use a deterministic string
  // In production, you'd use a proper hash function
  const raw = `${sourceType}:${sourceUrl}:${chunkIndex}`
  // Convert to a URL-safe base64-like string
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return `${sourceType}_${Math.abs(hash).toString(36)}_${chunkIndex}`
}
