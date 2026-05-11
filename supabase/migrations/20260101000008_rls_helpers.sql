-- ============================================================
-- 008_rls_helpers.sql — Helper for setting session context
-- ============================================================

CREATE OR REPLACE FUNCTION set_app_context(
  p_org_id text,
  p_user_id text,
  p_dept_id text DEFAULT '',
  p_role text DEFAULT 'member'
)
RETURNS void AS $$
BEGIN
  -- Third arg = true → setting is LOCAL to the current transaction.
  -- Prevents session variable leakage across requests when the
  -- connection pool reuses a connection.
  PERFORM set_config('app.org_id', p_org_id, true);
  PERFORM set_config('app.user_id', p_user_id, true);
  PERFORM set_config('app.department_id', p_dept_id, true);
  PERFORM set_config('app.user_role', p_role, true);
END;
$$ LANGUAGE plpgsql;

-- Ensure service_role can call this
GRANT EXECUTE ON FUNCTION set_app_context(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION set_app_context(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_app_context(text, text, text, text) TO anon;

-- ============================================================
-- Helper: check if session_grants temp table exists
-- ============================================================
CREATE OR REPLACE FUNCTION has_session_grants()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'session_grants'
      AND n.nspname LIKE 'pg_temp_%'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Vector search function
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content_preview text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.id,
    de.document_id,
    de.content_preview,
    de.metadata,
    1 - (de.embedding <=> query_embedding) AS similarity
  FROM document_embeddings de
  WHERE 1 - (de.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- ============================================================
-- vector_search — main retrieval RPC (ATH-33)
-- ============================================================
CREATE OR REPLACE FUNCTION vector_search (
  p_org_id uuid,
  p_user_id uuid,
  p_embedding vector(1536),
  p_limit int DEFAULT 5
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  content_preview text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.id as chunk_id,
    de.document_id,
    de.content_preview,
    de.metadata,
    1 - (de.embedding <=> p_embedding) AS similarity
  FROM document_embeddings de
  WHERE de.org_id = p_org_id
    AND 1 - (de.embedding <=> p_embedding) > 0.5 -- Default threshold
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$;

-- ============================================================
-- vector_search_cross_dept — super_user/admin retrieval (ATH-34)
-- ============================================================
CREATE OR REPLACE FUNCTION vector_search_cross_dept (
  p_org_id uuid,
  p_embedding vector(1536),
  p_limit int DEFAULT 5
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  content_preview text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.id as chunk_id,
    de.document_id,
    de.content_preview,
    de.metadata,
    1 - (de.embedding <=> p_embedding) AS similarity
  FROM document_embeddings de
  WHERE de.org_id = p_org_id
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$;

-- Session grants helper (temp table for current transaction)
CREATE OR REPLACE FUNCTION set_session_grants(p_grants jsonb)
RETURNS void AS $$
BEGIN
  CREATE TEMPORARY TABLE IF NOT EXISTS session_grants (
    scope_type grant_scope,
    scope_id text
  ) ON COMMIT DROP;
  
  DELETE FROM session_grants;
  
  INSERT INTO session_grants (scope_type, scope_id)
  SELECT (x->>'scope_type')::grant_scope, x->>'scope_id'
  FROM jsonb_array_elements(p_grants) AS x;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION set_session_grants(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION set_session_grants(jsonb) TO authenticated;

-- GRANT Table permissions (PostgREST requires these for RLS to even trigger)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated, anon;

-- ============================================================
-- store_llm_key — Admin helper to upsert encrypted key (ATH-40)
-- ============================================================
CREATE OR REPLACE FUNCTION store_llm_key(
  p_org_id uuid,
  p_provider text,
  p_plaintext text,
  p_kms_key text
)
RETURNS void AS $$
BEGIN
  INSERT INTO llm_keys (org_id, provider, key_encrypted, key_hint, created_by)
  VALUES (
    p_org_id,
    p_provider,
    pgp_sym_encrypt(p_plaintext, p_kms_key),
    '...' || right(p_plaintext, 4),
    (SELECT id FROM org_members WHERE org_id = p_org_id AND role = 'admin' LIMIT 1)
  )
  ON CONFLICT (org_id, provider) WHERE is_active = true
  DO UPDATE SET
    key_encrypted = pgp_sym_encrypt(p_plaintext, p_kms_key),
    key_hint = '...' || right(p_plaintext, 4),
    updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- get_decrypted_llm_key — LLM Factory helper (ATH-41)
-- ============================================================
CREATE OR REPLACE FUNCTION get_decrypted_llm_key(
  p_org_id uuid,
  p_kms_key text
)
RETURNS TABLE (
  provider text,
  plaintext text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    lk.provider,
    pgp_sym_decrypt(lk.key_encrypted, p_kms_key) as plaintext
  FROM llm_keys lk
  WHERE lk.org_id = p_org_id
    AND lk.is_active = true;
END;
$$ LANGUAGE plpgsql STABLE;
