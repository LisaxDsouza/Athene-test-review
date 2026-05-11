-- ============================================================
-- 001_schema.sql — Core tables for Athene AI
-- ============================================================
-- Run order: 001 → 002 → 003 → 004 → 005 → 006 → 007
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "vector";         -- pgvector
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid, pgp_sym_encrypt
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- trigram text search fallback

-- ============================================================
-- Custom ENUM types
-- ============================================================

CREATE TYPE IF NOT EXISTS user_role AS ENUM ('member', 'super_user', 'admin');

CREATE TYPE IF NOT EXISTS visibility_level AS ENUM (
  'org_wide',        -- visible to everyone in the org
  'department',      -- visible only to members of that department
  'bi_accessible',   -- visible to department + any super_user with a grant
  'confidential',    -- visible only to department members + admins (grants CANNOT unlock)
  'restricted'       -- visible only to the owner (personal Gmail, Calendar, etc.)
);

CREATE TYPE IF NOT EXISTS grant_scope AS ENUM (
  'department',      -- grant access to an entire department's docs
  'resource',        -- grant access to a specific document or folder
  'source'           -- grant access to all docs from a source type (e.g., all Jira)
);

CREATE TYPE IF NOT EXISTS connection_scope AS ENUM (
  'org',             -- admin-connected, shared across the org
  'user'             -- user-connected, personal (Gmail, personal Calendar)
);

CREATE TYPE IF NOT EXISTS connection_status AS ENUM (
  'active',
  'syncing',
  'error',
  'disconnected'
);

CREATE TYPE IF NOT EXISTS hitl_decision AS ENUM (
  'approved',
  'edited',
  'rejected'
);

-- ============================================================
-- 1. Organizations
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id    text UNIQUE NOT NULL,
  name            text NOT NULL,
  slug            text UNIQUE NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. Departments
-- ============================================================

CREATE TABLE IF NOT EXISTS departments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, slug)
);

-- ============================================================
-- 3. Organization Members
-- ============================================================

CREATE TABLE IF NOT EXISTS org_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  clerk_user_id   text NOT NULL,
  email           text NOT NULL,
  display_name    text,
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  role            user_role NOT NULL DEFAULT 'member',
  active          boolean NOT NULL DEFAULT true,
  timezone        text DEFAULT 'UTC',
  briefing_enabled  boolean NOT NULL DEFAULT false,
  briefing_delivery text DEFAULT 'in_app',   -- 'in_app' | 'email'
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, clerk_user_id)
);

-- ============================================================
-- 4. Access Grants (per-super_user custom cross-scope access)
-- ============================================================
-- Each row = "user X is granted access to scope Y"
-- Two super_users can have completely different grants.
-- Grants are additive only — they add access, never remove.
-- Grants CANNOT unlock 'confidential' visibility docs.

CREATE TABLE IF NOT EXISTS access_grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES org_members(id) ON DELETE CASCADE,
  scope_type      grant_scope NOT NULL,
  scope_id        text NOT NULL,             -- department UUID, document_id, or source name
  granted_by      uuid NOT NULL REFERENCES org_members(id),
  reason          text,                      -- audit: why was this granted?
  expires_at      timestamptz,               -- NULL = permanent
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, user_id, scope_type, scope_id)
);

-- ============================================================
-- 5. Connections (Nango-managed OAuth integrations)
-- ============================================================
-- Rule #3: NEVER store OAuth tokens. Only nango_connection_id.

CREATE TABLE IF NOT EXISTS connections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES org_members(id) ON DELETE CASCADE,  -- NULL = org-level
  nango_connection_id text NOT NULL,
  provider            text NOT NULL,         -- 'google', 'microsoft', 'atlassian'
  source_type         text NOT NULL,         -- 'gdrive', 'gmail', 'sharepoint', 'outlook', 'jira', 'confluence', 'gcalendar', 'outlook_calendar'
  scope               connection_scope NOT NULL,
  department_id       uuid REFERENCES departments(id),  -- which dept this source maps to
  status              connection_status NOT NULL DEFAULT 'active',
  last_synced_at      timestamptz,
  sync_cursor         text,                  -- provider-specific pagination cursor for delta sync
  error_message       text,
  metadata            jsonb DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. Documents (metadata only — NEVER store content. Rule #2)
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id   uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  external_id     text NOT NULL,             -- ID in the source system
  title           text,
  source_type     text NOT NULL,
  department_id   uuid REFERENCES departments(id),
  owner_user_id   uuid REFERENCES org_members(id),
  visibility      visibility_level NOT NULL DEFAULT 'department',
  mime_type       text,
  external_url    text,                      -- deep link back to source
  content_hash    text,                      -- SHA256 for delta sync
  chunk_count     int NOT NULL DEFAULT 0,
  last_indexed_at timestamptz,
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, connection_id, external_id)
);

-- ============================================================
-- 7. Document Embeddings (the core retrieval table)
-- ============================================================
-- 512-token chunks with 64-token overlap.
-- Embedding model: text-embedding-3-small, dimension 1536 (fixed).
-- content_preview = first 200 chars only (Rule #2).

CREATE TABLE IF NOT EXISTS document_embeddings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id     uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index     int NOT NULL,
  content_preview text,
  embedding       vector(1536) NOT NULL,
  department_id   uuid REFERENCES departments(id),
  owner_user_id   uuid REFERENCES org_members(id),
  visibility      visibility_level NOT NULL,
  source_type     text NOT NULL,
  token_count     int,
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (document_id, chunk_index)
);

-- ============================================================
-- 8. Knowledge Graph — Nodes (Graphify-powered)
-- ============================================================
-- One org-wide graph per org. Access-controlled via RLS.
-- Each node represents an entity extracted from indexed docs.

CREATE TABLE IF NOT EXISTS kg_nodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label           text NOT NULL,
  entity_type     text NOT NULL,             -- 'person', 'project', 'service', 'concept', 'team', 'technology', 'process'
  department_ids  uuid[] NOT NULL DEFAULT '{}',  -- can span multiple departments
  visibility      visibility_level NOT NULL DEFAULT 'department',
  source_documents text[] NOT NULL DEFAULT '{}', -- document IDs that mention this entity
  community       int,                        -- Leiden cluster ID
  description     text,                       -- short entity description
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, label, entity_type)
);

-- ============================================================
-- 9. Knowledge Graph — Edges (relationships between entities)
-- ============================================================

CREATE TABLE IF NOT EXISTS kg_edges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_node     uuid NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
  target_node     uuid NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
  relation        text NOT NULL,             -- 'DEPENDS_ON', 'OWNS', 'FEEDS', 'MENTIONS', 'USES', 'RELATED_TO'
  provenance      text NOT NULL DEFAULT 'EXTRACTED',  -- 'EXTRACTED', 'INFERRED', 'AMBIGUOUS'
  confidence      float DEFAULT 1.0,         -- 0.0–1.0 for INFERRED edges
  source_document text,                      -- document that sourced this relationship
  department_id   uuid REFERENCES departments(id),
  visibility      visibility_level NOT NULL DEFAULT 'department',
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, source_node, target_node, relation)
);

-- ============================================================
-- 10. Threads (LangGraph conversation threads)
-- ============================================================

CREATE TABLE IF NOT EXISTS threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES org_members(id) ON DELETE CASCADE,
  title           text,
  last_message_at timestamptz,
  message_count   int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 11. Thread Checkpoints (LangGraph state persistence)
-- ============================================================

CREATE TABLE IF NOT EXISTS thread_checkpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  checkpoint      jsonb NOT NULL,
  parent_id       uuid REFERENCES thread_checkpoints(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 12. HITL Decisions (approve / edit / reject audit trail)
-- ============================================================

CREATE TABLE IF NOT EXISTS hitl_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id       uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES org_members(id),
  action_type     text NOT NULL,             -- 'email-send', 'calendar-create'
  decision        hitl_decision NOT NULL,
  original_payload jsonb,
  edited_payload  jsonb,
  decided_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 13. Grant Access Audit (every cross-scope read by super_user)
-- ============================================================

CREATE TABLE IF NOT EXISTS grant_access_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES org_members(id),
  grant_id        uuid REFERENCES access_grants(id) ON DELETE SET NULL,
  scope_used      text NOT NULL,
  document_ids    text[] NOT NULL,
  query_hash      text,
  accessed_at     timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 14. Admin Actions (general admin audit log)
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  admin_user_id   uuid NOT NULL REFERENCES org_members(id),
  action          text NOT NULL,             -- 'grant_access', 'revoke_access', 'change_role', 'invite_user', 'deactivate_user', 'add_key', 'delete_key'
  target_user_id  uuid REFERENCES org_members(id),
  details         jsonb DEFAULT '{}',
  performed_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 15. Cross-Dept Audit Log (consolidated from legacy)
-- ============================================================

CREATE TABLE IF NOT EXISTS cross_dept_audit_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid,                      -- optional, links to a conversation thread
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             text NOT NULL,             -- Clerk user ID
  queried_dept_ids    uuid[] NOT NULL DEFAULT '{}',
  chunk_ids_accessed  text[] NOT NULL DEFAULT '{}',
  prompt_hash         text NOT NULL,             -- privacy-safe SHA256 of the user query
  grant_id            uuid REFERENCES access_grants(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- updated_at trigger function (reusable)
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_org_members_updated_at
  BEFORE UPDATE ON org_members FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_connections_updated_at
  BEFORE UPDATE ON connections FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_threads_updated_at
  BEFORE UPDATE ON threads FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_kg_nodes_updated_at
  BEFORE UPDATE ON kg_nodes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
