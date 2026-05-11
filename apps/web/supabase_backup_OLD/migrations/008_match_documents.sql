CREATE OR REPLACE FUNCTION match_document_embeddings(query_embedding vector(1536), match_count int DEFAULT 8)
RETURNS TABLE (
  chunk_id uuid,
  dept_id uuid,
  source_type text,
  source_id text,
  source_url text,
  metadata jsonb,
  visibility text,
  score double precision
)
LANGUAGE sql STABLE AS $$
  SELECT
    de.chunk_id,
    de.dept_id,
    de.source_type,
    de.source_id,
    de.source_url,
    de.metadata,
    de.visibility,
    1 - (de.embedding <=> query_embedding) AS score
  FROM document_embeddings de
  ORDER BY de.embedding <=> query_embedding
  LIMIT match_count;
$$;
