-- ATH-20 / 001_schema.sql
create extension if not exists vector;
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table if not exists org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id text not null,
  email text not null,
  role text not null check (role in ('member','bi_analyst','admin')),
  dept_id uuid references departments(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table if not exists bi_access_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id text not null,
  dept_id uuid not null references departments(id) on delete cascade,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (org_id, user_id, dept_id)
);

create table if not exists document_embeddings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  document_id text not null,
  chunk_id text not null,
  chunk_index int not null,
  embedding vector(1536) not null,
  dept_id uuid references departments(id) on delete set null,
  owner_user_id text,
  visibility text not null check (visibility in ('org_wide','department','bi_accessible','confidential','restricted')),
  source_type text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (org_id, chunk_id)
);

create table if not exists org_integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  provider text not null,
  nango_connection_id text not null,
  status text not null default 'active',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, nango_connection_id)
);

create table if not exists org_api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  provider text not null,
  key_encrypted bytea not null,
  key_hint text not null,
  is_active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_org_api_keys_one_active on org_api_keys (org_id, provider) where is_active = true;

create table if not exists langgraph_checkpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id text not null,
  thread_id text not null,
  checkpoint jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id text not null,
  thread_id text not null,
  final_answer text not null,
  citations jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists cross_dept_audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id text not null,
  query text not null,
  dept_ids uuid[] not null default '{}',
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists pending_background_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  source_type text not null,
  url text not null,
  body jsonb not null,
  status text not null default 'waiting' check (status in ('waiting','processing','failed')),
  created_at timestamptz not null default now()
);

create table if not exists user_automations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id text not null,
  automation_type text not null,
  cron_expression text not null,
  config jsonb not null default '{}',
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, automation_type)
);
