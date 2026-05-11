import { withRLS } from './rls-client'

export interface VectorChunk {
  chunk_id: string
  source_url: string | null
  title: string | null
  metadata: Record<string, unknown>
  score: number
}

export async function similaritySearch(
  orgId: string,
  userId: string,
  queryEmbedding: number[],
  topK: number,
  deptFilter?: string,
): Promise<VectorChunk[]> {
  return withRLS({ org_id: orgId, user_id: userId, user_role: 'member' }, async (client) => {
    let query = client
      .from('document_embeddings')
      .select('chunk_id, source_url, title, metadata, dept_id, embedding')
      .limit(topK)

    if (deptFilter) {
      query = query.eq('dept_id', deptFilter)
    }

    const { data, error } = await query
    if (error) throw error

    // keep distance in DB for production rpc; placeholder score for scaffold
    return (data ?? []).map((row) => ({
      chunk_id: row.chunk_id,
      source_url: (row as Record<string, unknown>).source_url as string | null,
      title: (row as Record<string, unknown>).title as string | null,
      metadata: (row as Record<string, unknown>).metadata as Record<string, unknown>,
      score: 1,
    }))
  })
}

export async function crossDeptSearch(
  orgId: string,
  userId: string,
  queryEmbedding: number[],
  topK: number,
  deptIds: string[],
): Promise<VectorChunk[]> {
  return withRLS({ org_id: orgId, user_id: userId, user_role: 'member', grant_ids: deptIds }, async (client) => {
    const { data, error } = await client
      .from('document_embeddings')
      .select('chunk_id, source_url, title, metadata, dept_id, embedding')
      .in('dept_id', deptIds)
      .limit(topK)

    if (error) throw error

    return (data ?? []).map((row) => ({
      chunk_id: row.chunk_id,
      source_url: (row as Record<string, unknown>).source_url as string | null,
      title: (row as Record<string, unknown>).title as string | null,
      metadata: (row as Record<string, unknown>).metadata as Record<string, unknown>,
      score: 1,
    }))
  })
}
