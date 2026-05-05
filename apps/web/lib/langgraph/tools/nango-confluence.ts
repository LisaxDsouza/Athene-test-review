// ============================================================
// nango-confluence.ts — Bulk indexing pipeline for Confluence (ATH-31)
//
// Fetches all pages from a Confluence space via pagination,
// strips HTML storage format to plain text, converts to
// FetchedChunk[], and passes to indexDocuments() for chunking,
// embedding, and vector upsert.
//
// Rule #2: content lives only in RAM — it is passed to
// indexDocuments() which embeds it, then discards it. No page
// body is ever written to Supabase directly.
// ============================================================

import { getCloudId, atlassianFetch } from '@/lib/integrations/atlassian/client'
import { stripHtml } from '@/lib/integrations/atlassian/confluence-html'
import { indexDocuments } from '@/lib/integrations/indexing'
import type { FetchedChunk } from '@/lib/integrations/base'

// ---- Types --------------------------------------------------

interface ConfluencePage {
  id: string
  title: string
  body?: {
    storage?: {
      value: string
    }
  }
  version?: {
    when: string
    by?: { displayName: string }
  }
  metadata?: {
    labels?: {
      results: Array<{ name: string }>
    }
  }
  _links: {
    webui: string
    next?: string
  }
}

interface ConfluencePageResult {
  results: ConfluencePage[]
  _links?: {
    next?: string
  }
}

export interface IndexConfluenceResult {
  indexed: number
  failed: number
}

// ---- Bulk indexing ------------------------------------------

/**
 * Bulk indexing pipeline for a Confluence space.
 * Fetches all pages via paginated API, converts to FetchedChunk[],
 * and sends to the shared indexing pipeline for embedding + vector upsert.
 *
 * Runs via QStash background worker — not called in the request path.
 *
 * @param connectionId - Nango connection ID
 * @param spaceKey     - Confluence space key (e.g. "ENG", "DOCS")
 * @param orgId        - Clerk org ID for RLS context
 * @param deptId       - Department ID for access scoping
 */
export async function indexConfluenceSpace(
  connectionId: string,
  spaceKey: string,
  orgId: string,
  deptId: string | null
): Promise<IndexConfluenceResult> {
  const cloudId = await getCloudId(connectionId, orgId, 'confluence')
  let start = 0
  const limit = 25
  let totalIndexed = 0
  let totalFailed = 0

  while (true) {
    const data = await atlassianFetch<ConfluencePageResult>(
      connectionId,
      cloudId,
      `/wiki/rest/api/content?spaceKey=${spaceKey}&expand=body.storage,version,metadata.labels&limit=${limit}&start=${start}`,
      orgId,
      'confluence'
    )

    if (!data.results || data.results.length === 0) break

    // Build FetchedChunk[] for this batch — content stays in RAM
    const chunks: FetchedChunk[] = []

    for (const page of data.results) {
      const htmlContent = page.body?.storage?.value ?? ''
      const content = stripHtml(htmlContent)

      // Skip empty pages — nothing to embed
      if (!content.trim()) continue

      const labels = page.metadata?.labels?.results?.map((l) => l.name) ?? []

      chunks.push({
        chunk_id: `confluence-page-${page.id}`,
        title: page.title,
        content: `${page.title}\n\n${content}`,
        source_url: `https://athene-ai.atlassian.net/wiki${page._links.webui}`,
        metadata: {
          provider: 'confluence',
          resource_type: 'page',
          space_key: spaceKey,
          page_id: page.id,
          labels,
          last_modified: page.version?.when ?? undefined,
          author: page.version?.by?.displayName ?? undefined,
        },
      })
    }

    if (chunks.length > 0) {
      const { indexed, errors } = await indexDocuments(chunks, orgId, connectionId, deptId)
      totalIndexed += indexed
      totalFailed += errors
    }

    if (!data._links?.next) break
    start += limit
  }

  return { indexed: totalIndexed, failed: totalFailed }
}
