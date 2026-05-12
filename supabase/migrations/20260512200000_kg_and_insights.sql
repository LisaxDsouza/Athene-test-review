-- ============================================================
-- Knowledge Graph tables (kg_nodes, kg_edges) and Insights table
-- ============================================================

-- Enable pgvector if not already enabled (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── kg_nodes ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kg_nodes (
  id                   text        NOT NULL,
  org_id               uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label                text        NOT NULL,
  type                 text        NOT NULL,
  properties           jsonb       NOT NULL DEFAULT '{}',
  source_document_id   text,
  source_type          text,
  description_embedding vector(1536),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, org_id)
);

ALTER TABLE kg_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_kg_nodes" ON kg_nodes
  FOR SELECT USING (
    org_id = (current_setting('app.org_id', true))::uuid
  );

CREATE POLICY "service_role_all_kg_nodes" ON kg_nodes
  FOR ALL USING (auth.role() = 'service_role');

-- ─── kg_edges ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kg_edges (
  id            bigserial   PRIMARY KEY,
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_node_id  text        NOT NULL,
  to_node_id    text        NOT NULL,
  relation      text        NOT NULL,
  weight        float       NOT NULL DEFAULT 0.8,
  visibility    text        NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'restricted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, from_node_id, to_node_id, relation)
);

ALTER TABLE kg_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_kg_edges" ON kg_edges
  FOR SELECT USING (
    org_id = (current_setting('app.org_id', true))::uuid
  );

CREATE POLICY "service_role_all_kg_edges" ON kg_edges
  FOR ALL USING (auth.role() = 'service_role');

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS kg_nodes_org_idx ON kg_nodes (org_id);
CREATE INDEX IF NOT EXISTS kg_nodes_embedding_idx
  ON kg_nodes USING ivfflat (description_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS kg_edges_from_idx ON kg_edges (org_id, from_node_id);
CREATE INDEX IF NOT EXISTS kg_edges_to_idx   ON kg_edges (org_id, to_node_id);

-- ─── kg_node_search RPC ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION kg_node_search(
  p_org_id   uuid,
  p_embedding vector(1536),
  p_limit    int DEFAULT 10
)
RETURNS TABLE (
  id          text,
  label       text,
  type        text,
  properties  jsonb,
  similarity  float
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    id,
    label,
    type,
    properties,
    1 - (description_embedding <=> p_embedding) AS similarity
  FROM kg_nodes
  WHERE org_id = p_org_id
    AND description_embedding IS NOT NULL
  ORDER BY description_embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- ─── insights ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS insights (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id      text        NOT NULL,
  query        text        NOT NULL,
  result       text,
  citations    jsonb       NOT NULL DEFAULT '[]',
  refreshed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE insights ENABLE ROW LEVEL SECURITY;

-- Users see their own insights; admins see all in their org
CREATE POLICY "users_own_insights" ON insights
  FOR SELECT USING (
    user_id = (current_setting('app.user_id', true))
    AND org_id = (current_setting('app.org_id', true))::uuid
  );

CREATE POLICY "admin_read_all_insights" ON insights
  FOR SELECT USING (
    org_id = (current_setting('app.org_id', true))::uuid
    AND (current_setting('app.user_role', true)) = 'admin'
  );

CREATE POLICY "users_insert_own_insights" ON insights
  FOR INSERT WITH CHECK (
    user_id = (current_setting('app.user_id', true))
    AND org_id = (current_setting('app.org_id', true))::uuid
  );

CREATE POLICY "users_update_own_insights" ON insights
  FOR UPDATE USING (
    user_id = (current_setting('app.user_id', true))
    AND org_id = (current_setting('app.org_id', true))::uuid
  );

CREATE POLICY "service_role_all_insights" ON insights
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS insights_org_user_idx ON insights (org_id, user_id);

-- ─── match_documents RPC (vector search for retrieval agent) ──────────────────

CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_count     int,
  p_org_id        uuid
)
RETURNS TABLE (
  chunk_id      text,
  document_id   text,
  content_preview text,
  chunk_index   int,
  source_type   text,
  external_url  text,
  department_id uuid,
  community_id  text,
  similarity    float
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    id::text                              AS chunk_id,
    document_id,
    LEFT(content, 500)                    AS content_preview,
    chunk_index,
    source_type,
    source_url                            AS external_url,
    dept_id                               AS department_id,
    NULL::text                            AS community_id,
    1 - (embedding <=> query_embedding)   AS similarity
  FROM document_embeddings
  WHERE org_id = p_org_id
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
