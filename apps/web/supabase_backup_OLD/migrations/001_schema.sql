CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE departments (
  dept_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, slug)
);

CREATE TABLE org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  org_id text NOT NULL,
  dept_id uuid REFERENCES departments(dept_id),
  role text NOT NULL CHECK (role IN ('admin','member','bi_analyst')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, org_id)
);

CREATE TABLE bi_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  org_id text NOT NULL,
  granted_dept_ids uuid[] NOT NULL,
  granted_by text NOT NULL,
  granted_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  is_active boolean DEFAULT true
);

CREATE TABLE document_embeddings (
  chunk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  dept_id uuid REFERENCES departments(dept_id),
  source_type text NOT NULL CHECK (source_type IN ('sharepoint','onedrive','gdrive','jira','confluence','notion','outlook','gmail')),
  source_id text NOT NULL,
  source_url text NOT NULL,
  content_hash text NOT NULL,
  chunk_index integer NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('org_wide','department','bi_accessible','confidential','restricted')),
  embedding vector(1536) NOT NULL,
  metadata jsonb NOT NULL,
  indexed_at timestamptz DEFAULT now(),
  UNIQUE(org_id, source_id, chunk_index)
);

CREATE TABLE org_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  dept_id uuid REFERENCES departments(dept_id),
  source_type text NOT NULL CHECK (source_type IN ('sharepoint','onedrive','gdrive','jira','confluence','notion','outlook','gmail')),
  nango_connection_id text NOT NULL,
  index_mode text NOT NULL CHECK (index_mode IN ('index_live_fetch','pure_live_search')),
  visibility_default text DEFAULT 'department' CHECK (visibility_default IN ('org_wide','department','bi_accessible','confidential','restricted')),
  delta_token text,
  last_synced_at timestamptz,
  sync_status text DEFAULT 'idle',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE org_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('anthropic','openai','gemini','azure_openai','custom')),
  label text NOT NULL,
  encrypted_key text NOT NULL,
  key_hint text NOT NULL,
  custom_endpoint text,
  is_active boolean DEFAULT true,
  added_by text NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, provider)
);

CREATE TABLE langgraph_checkpoints (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  parent_checkpoint_id text,
  org_id text NOT NULL,
  user_id text NOT NULL,
  checkpoint jsonb NOT NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id text NOT NULL UNIQUE,
  org_id text NOT NULL,
  user_id text NOT NULL,
  dept_id uuid,
  prompt text NOT NULL,
  final_answer text,
  cited_sources jsonb,
  agent_path text[],
  model_used text,
  was_cross_dept boolean DEFAULT false,
  run_status text DEFAULT 'running',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE cross_dept_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id text NOT NULL,
  user_id text NOT NULL,
  org_id text NOT NULL,
  queried_dept_ids uuid[] NOT NULL,
  chunk_ids_accessed uuid[] NOT NULL,
  prompt_hash text NOT NULL,
  grant_id uuid REFERENCES bi_access_grants(id),
  accessed_at timestamptz DEFAULT now()
);

CREATE TABLE pending_background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id text,
  tool_call_id text,
  org_id text NOT NULL,
  tool_name text,
  tool_args jsonb,
  status text DEFAULT 'waiting' CHECK (status IN ('waiting','dispatched','complete','failed')),
  qstash_msg_id text,
  created_at timestamptz DEFAULT now(),
  dispatched_at timestamptz
);

CREATE TABLE user_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  org_id text NOT NULL,
  automation_type text NOT NULL,
  cron_expression text NOT NULL,
  timezone text NOT NULL,
  config jsonb,
  is_active boolean DEFAULT true,
  qstash_schedule_id text,
  last_run_at timestamptz,
  created_at timestamptz DEFAULT now()
);
