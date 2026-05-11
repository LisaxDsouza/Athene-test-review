# Athene AI — Project Handover & Vercel Deployment Guide

**Repo:** https://github.com/mudxssir/Athene-test-review  
**Stack:** Next.js 16 · LangGraph · Supabase · Clerk · Nango · DeepSeek · Upstash  
**Last updated:** May 2026

---

## Table of Contents

1. [What Athene AI Is](#1-what-athene-ai-is)
2. [What Was Built](#2-what-was-built)
3. [Work Done in This Session](#3-work-done-in-this-session)
4. [Architecture Overview](#4-architecture-overview)
5. [Deploying to Vercel](#5-deploying-to-vercel)
6. [Environment Variables Reference](#6-environment-variables-reference)
7. [Post-Deploy Checklist](#7-post-deploy-checklist)
8. [What Still Needs Work](#8-what-still-needs-work)
9. [Codebase Map](#9-codebase-map)
10. [Known Constraints](#10-known-constraints)

---

## 1. What Athene AI Is

Athene AI is an **intelligent enterprise assistant** for organizations. Users connect their data sources (Google Drive, Slack, Notion, Outlook, HubSpot, etc.), and Athene indexes that data into a knowledge graph + vector store. Users then ask natural-language questions in a chat interface and get cited, org-aware answers.

**Core user flows:**
- **Ask** — chat with your org's knowledge base, get answers with document citations
- **Act** — ask Athene to send emails or create calendar events; it drafts them and asks for your approval before sending
- **Brief** — daily morning briefing summarizing calendar, priority emails, and doc updates
- **Insights** — cross-department BI queries for analysts (role-gated)
- **Integrations** — connect and manage data sources via OAuth

---

## 2. What Was Built

### Pages (all fully implemented)

| Route | What it does |
|-------|-------------|
| `/` | Landing page — sign in prompt |
| `/sign-in` | Clerk auth |
| `/sign-up` | Clerk auth |
| `/chat` | Main chat interface with HITL approval UI |
| `/briefing` | Daily briefing viewer (calendar, emails, doc updates) |
| `/insights` | Saved BI query results |
| `/admin/users` | Org member management via Clerk |
| `/admin/integrations` | Connect/disconnect data sources via Nango OAuth |
| `/admin/keys` | BYOK LLM key management (encrypted at rest) |
| `/admin/grants` | BI analyst cross-dept access grants |
| `/admin/automations` | Enable/configure scheduled automations |
| `/admin/audit` | Security and admin activity log |

### Agents (all fully implemented)

| Agent | What it does |
|-------|-------------|
| `supervisor` | Classifies intent, routes to the right agent, enforces RBAC |
| `retrieval_agent` | Vector search + 2-hop KG traversal |
| `cross_dept_agent` | Cross-department retrieval (bi_analyst/admin only) |
| `email_agent` | Drafts emails from context → HITL → sends via Outlook |
| `calendar_agent` | Parses scheduling intent → HITL → creates calendar event |
| `report_agent` | Multi-source report generation with KG context |
| `data_index_agent` | Re-indexes data sources on demand → HITL → queues worker |
| `synthesis_agent` | Generates final answer with citations from all retrieved context |

### Data Sources Supported (via Nango)
Google Drive, Gmail, Google Calendar, Microsoft/Outlook, SharePoint, Slack, Notion, HubSpot, Salesforce, Snowflake, GitHub, Linear, Zendesk, Jira, Confluence

---

## 3. Work Done in This Session

The following was fixed/built from the original `prajwal-vl/Athene-test-review` repo:

### Critical fixes
- **Middleware rename** — `proxy.ts` → `middleware.ts` (Next.js only auto-runs `middleware.ts`; auth was silently not enforced)
- **Redis cold-start crash** — was calling `Redis.fromEnv()` at module load; replaced with lazy proxy pattern
- **QStash unsafe init** — removed `!` assertion; now lazy proxy matching Redis pattern
- **Missing SQL functions** — added `vector_search()`, `vector_search_cross_dept()`, `store_llm_key()`, `get_decrypted_llm_key()`, `has_session_grants()` migrations
- **Migration idempotency** — all `CREATE TABLE` and `CREATE TYPE` statements wrapped in `IF NOT EXISTS` / `DO $$ BEGIN ... EXCEPTION` blocks; fresh deploys no longer fail
- **Auth redirect loop** — removed `!orgId → redirect('/sign-in')` which caused infinite loops for users without a Clerk org

### Agent wiring
- **Email, calendar, report agents** — all three were fully implemented but `graph.ts` still had `stubNode()` for all of them; wired in the real implementations
- **data_index_agent** — was a stub entirely; built from scratch: LLM resolves which documents to reindex, HITL approval, dispatches to `index-delta` worker

### Production hardening
- **Embedding retry** — silent data loss on OpenAI API failure replaced with exponential backoff (3 retries: 1s/2s/4s); job fails hard on exhaustion so QStash retries
- **Rate limit backoff** — all Nango fetchers wrapped with `retryWithBackoff`; 429 detection uses 60s base delay; partial sync continues past individual fetcher failures
- **HITL fire-and-forget** — graph resume now races against 25s timeout; short actions return 200 confirmed, long actions return 202 (client should poll), errors return 500
- **Env validation at startup** — `lib/config/env-check.ts` validates all required vars at module load
- **KG stale doc cleanup** — connection deletion now strips deleted document IDs from `kg_nodes.source_documents[]` and removes nodes with empty source arrays
- **RLS defense-in-depth** — briefings and insights routes use `withRLS()` instead of raw `supabaseAdmin`

### Vercel deployment
- `vercel.json` with 300s timeouts for agent and worker routes
- `export const maxDuration = 300` added to all long-running route files
- `app-url.ts` falls back to Vercel's auto-injected `VERCEL_URL`
- Complete `.env.example` with setup instructions

### Audit log page
- `/admin/audit` was a "coming soon" stub; built full table UI backed by existing `/api/admin/audit-log` endpoint

---

## 4. Architecture Overview

```
User
  │
  ▼
Clerk Auth (middleware.ts)
  │  injects x-current-user-id, x-current-org-id, x-current-user-role headers
  ▼
Next.js App Router
  │
  ├── /chat ──────────────► POST /api/agent
  │                               │
  │                         LangGraph StateGraph
  │                         (Postgres checkpointer)
  │                               │
  │                    supervisor (LLM routing + RBAC)
  │                         │         │         │
  │                  retrieval   email_agent  calendar_agent
  │                  _agent      (HITL)       (HITL)
  │                    │              │
  │             vector_search()   approval_node ← graph interrupted here
  │             + KG traversal        │
  │                    │         action_executor
  │                    └──────► synthesis_agent → SSE stream → chat UI
  │
  ├── /admin/integrations ──► Nango OAuth popup
  │                               │
  │                         POST /api/connections/sync
  │                               │
  │                         QStash → nango-fetch worker
  │                               │
  │                    chunk + embed (OpenAI text-embedding-3-small)
  │                    → document_embeddings table
  │                               │
  │                         QStash → graph-build worker
  │                               │
  │                    Claude Haiku entity extraction
  │                    → kg_nodes + kg_edges tables
  │
  └── /briefing ─────────────► GET /api/briefings
                                (populated by morning-briefing QStash worker)
```

### Multi-tenancy & Security
- Every DB query is org-scoped via Supabase RLS (`set_app_context(org_id, user_id, role, dept_id)`)
- RBAC roles: `member`, `bi_analyst`, `super_user`, `admin`
- Document visibility levels: `org_wide`, `department`, `bi_accessible`, `confidential`, `restricted`
- Nango tokens never stored — fetched per-request via service role with org ownership check
- BYOK LLM keys encrypted at rest via `pgp_sym_encrypt` in Postgres

---

## 5. Deploying to Vercel

### Step 1 — Import the repo

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository**
3. Select `mudxssir/Athene-test-review`
4. Framework will auto-detect as **Next.js** — leave all build settings as default
5. Do **not** deploy yet — add env vars first (Step 2)

### Step 2 — Add environment variables

In Vercel → Project Settings → Environment Variables, add every variable from `.env.example`.

See [Section 6](#6-environment-variables-reference) for where to get each value.

> **Tip:** Set variables for **Production**, **Preview**, and **Development** environments at once by selecting all three when adding each var.

### Step 3 — Deploy

Click **Deploy**. First build takes ~2 minutes. If it fails, check the build logs — the most common issue is a missing required env var.

### Step 4 — Run database migrations

After the first successful deploy, apply all Supabase migrations:

```bash
# Install Supabase CLI if needed
npm install -g supabase

# Log in with your Supabase access token
# Get it from: https://supabase.com/dashboard → Account → Access Tokens
export SUPABASE_ACCESS_TOKEN=sbp_...

# Link to your project (get project ref from Supabase dashboard URL)
npx supabase link --project-ref <your-project-ref>

# Push all migrations
npx supabase db push
```

### Step 5 — Configure Clerk webhook

Clerk webhooks sync org membership into Supabase so the app knows who belongs to which org.

1. Go to [dashboard.clerk.com](https://dashboard.clerk.com) → your app → **Webhooks**
2. Click **Add Endpoint**
3. Set URL to: `https://<your-vercel-url>/api/webhooks/clerk`
4. Subscribe to these events:
   - `organization.created`
   - `organizationMembership.created`
   - `organizationMembership.updated`
   - `organizationMembership.deleted`
5. Copy the **Signing Secret** (starts with `whsec_`)
6. Add it to Vercel env vars as `CLERK_WEBHOOK_SECRET`
7. Redeploy (Vercel → Deployments → Redeploy)

### Step 6 — Enable Clerk Organizations

1. In Clerk dashboard → **Configure** → **Organizations**
2. Toggle **Enable Organizations** on
3. Under **Permissions**, ensure members can invite others if needed

### Step 7 — Configure Nango

1. Create a Nango account at [app.nango.dev](https://app.nango.dev)
2. Set up integration configs for each provider you want to support
3. Copy your **Secret Key** and **Public Key** from Project Settings
4. Add to Vercel env vars as `NANGO_SECRET_KEY` and `NEXT_PUBLIC_NANGO_PUBLIC_KEY`

### Step 8 — Set up QStash (background workers)

1. Create an Upstash account at [console.upstash.com](https://console.upstash.com)
2. Go to **QStash** → copy `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`
3. Create a Redis database → copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
4. Add all four to Vercel env vars

### Step 9 — Verify deployment

Visit `https://<your-vercel-url>` and:
- [ ] Homepage loads with Athene branding
- [ ] Sign-up creates an account and lands on `/chat`
- [ ] Admin can connect a data source from `/admin/integrations`
- [ ] After connecting, chat returns answers from that source
- [ ] Morning briefing page shows at `/briefing`

---

## 6. Environment Variables Reference

| Variable | Where to get it | Required |
|----------|----------------|----------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys | ✅ |
| `CLERK_SECRET_KEY` | Clerk dashboard → API Keys | ✅ |
| `CLERK_WEBHOOK_SECRET` | Clerk dashboard → Webhooks → Signing Secret | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API | ✅ |
| `ENCRYPTION_SECRET` | Generate: `openssl rand -hex 32` | ✅ |
| `KMS_SECRET` | Generate: `openssl rand -hex 32` | ✅ |
| `DEEPSEEK_API_KEY` | platform.deepseek.com | ✅ (or any LLM key) |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Recommended |
| `OPENAI_API_KEY` | platform.openai.com | Recommended (for embeddings) |
| `UPSTASH_REDIS_REST_URL` | console.upstash.com → Redis | ✅ |
| `UPSTASH_REDIS_REST_TOKEN` | console.upstash.com → Redis | ✅ |
| `QSTASH_TOKEN` | console.upstash.com → QStash | ✅ |
| `QSTASH_CURRENT_SIGNING_KEY` | console.upstash.com → QStash | ✅ |
| `QSTASH_NEXT_SIGNING_KEY` | console.upstash.com → QStash | ✅ |
| `NANGO_SECRET_KEY` | app.nango.dev → Project Settings | ✅ |
| `NEXT_PUBLIC_NANGO_PUBLIC_KEY` | app.nango.dev → Project Settings | ✅ |
| `NEXT_PUBLIC_APP_URL` | Your Vercel deployment URL | Optional on Vercel |

---

## 7. Post-Deploy Checklist

- [ ] All env vars added in Vercel
- [ ] `supabase db push` run successfully (all migrations applied)
- [ ] Clerk webhook configured and `CLERK_WEBHOOK_SECRET` set
- [ ] Clerk Organizations feature enabled
- [ ] First user can sign up and reach `/chat`
- [ ] Admin can connect at least one data source
- [ ] Chat returns answers after indexing completes (~2-5 min after connecting)
- [ ] QStash workers receive jobs (check Upstash console → QStash → Messages)

---

## 8. What Still Needs Work

### Known limitations
- **No real-time sync** — data sources are re-indexed on manual trigger or on initial connect. Changes to source documents are not picked up until the next sync.
- **`audit_logs` table has no writers** — the `/admin/audit` page reads from `audit_logs` but nothing in the codebase currently writes to it. The page will always show an empty table until write calls are added throughout the app (e.g. on login, on config changes, on HITL approvals).

### Completed in latest session
The following items previously listed here are now implemented:

- **Mobile sidebar** — `Sheet` in `Header` made controlled (`open`/`onOpenChange`), `Sidebar` accepts `onNavClick` callback; tapping any nav link in the mobile drawer now closes it automatically. `SheetTitle` added for accessibility.
- **Google OAuth write actions** — `email_agent` and `calendar_agent` now detect the org's connected provider (Microsoft vs Google) at runtime and set `tool` to `gmail-send` / `google-calendar-create` accordingly. The `action-executor` dispatches to the correct Google API.
- **Automations cron wiring** — The `PATCH /api/admin/automations` endpoint now registers / cancels real QStash scheduled messages when an automation is toggled on/off. The admin UI has a toggle (power) button per automation row.
- **Nango `nango.yaml`** — `nango/nango.yaml` now defines all 16 supported integrations (Google Drive, Gmail, Google Calendar, Microsoft/Outlook/Calendar, Slack, Notion, HubSpot, Salesforce, GitHub, Linear, Zendesk, Jira, Confluence, Snowflake) using the exact provider keys from the `providerFetcherMap`.

### Bug-fix pass (post-handover audit)

Seven confirmed runtime failures found and fixed:

| # | Severity | File | Issue | Fix |
|---|----------|------|-------|-----|
| 1 | 🔴 Critical | 15 API routes + workers | **Clerk orgId passed as Supabase UUID** — every table's `org_id` column is `uuid` referencing `organizations(id)`, but all routes used the raw Clerk string (`org_xxx`) directly. Every DB query errored with `invalid input syntax for type uuid`. | Exported `resolveOrgUuid()` from `lib/auth/rbac.ts`; every route now resolves the UUID before any DB call. |
| 2 | 🔴 Critical | `lib/knowledge-graph/builder.ts:128` | **Non-existent column** — `.select('chunk_id, ...')` on `document_embeddings`; column is `id`. All graph builds failed. | Changed to `.select('id, ...')`. |
| 3 | 🔴 Critical | `lib/knowledge-graph/builder.ts:111` | **Wrong column name** — `dept_id` selected from `documents`; schema column is `department_id`. All KG nodes written with `department_id: undefined`. | Changed to `department_id`. |
| 4 | 🔴 Critical | `lib/agents/cross-dept-agent.ts:21` | **Stub tool imported** — imported `crossDeptVectorSearchTool` from `lib/tools/registry` (always returns `{ results: [] }`) instead of the real implementation in `lib/langgraph/tools/vector-search`. Cross-dept search always returned empty. | Changed import to `lib/langgraph/tools/vector-search`. |
| 5 | 🔴 Critical | `app/api/worker/nango-fetch/route.ts:298` | **Wrong document IDs to graph-build** — sent `FetchedChunk.chunk_id` (external provider IDs like Google Drive file IDs) to the graph-build worker as `document_ids`, but the builder queries `documents.id` (Supabase UUIDs). Every incremental graph build processed zero documents. | Modified `indexDocuments()` to return `documentIds: string[]` (Supabase UUIDs); worker now uses `result.documentIds`. |
| 6 | 🔴 Critical | `lib/langgraph/nodes/supervisor.ts:72` | **Hardcoded `ChatOpenAI` / `gpt-4o`** — supervisor crashed on every request if `OPENAI_API_KEY` was not set (env var is listed as "Recommended", not required). Entire agent system unusable without OpenAI. | Replaced with `resolveModelClient(state.org_id, 'simple')` — respects BYOK keys and falls back to the configured platform provider (DeepSeek, Anthropic, etc.). |
| 7 | 🟡 Medium | `lib/langgraph/nodes/supervisor.ts:125` | **Off-by-one in hop guard** — `if (state.hop_count >= MAX_HOPS)` checked the pre-increment value, so the supervisor ran 7 times before terminating instead of 6. | Changed to `if (hopCount > MAX_HOPS)` (post-increment). |

---

## 9. Codebase Map

```
Athene-test-review/
│
├── app/
│   ├── (dashboard)/          # All authenticated pages
│   │   ├── chat/             # Main chat UI
│   │   ├── briefing/         # Morning briefing viewer
│   │   ├── insights/         # BI query results
│   │   └── admin/
│   │       ├── users/        # Clerk org member management
│   │       ├── integrations/ # Nango data source connections
│   │       ├── keys/         # BYOK LLM key management
│   │       ├── grants/       # BI analyst access grants
│   │       ├── automations/  # Scheduled automation config
│   │       └── audit/        # Security audit log
│   ├── api/
│   │   ├── agent/            # LangGraph streaming endpoint
│   │   ├── admin/            # Admin CRUD endpoints
│   │   ├── briefings/        # Briefing fetch
│   │   ├── connections/      # Nango connection management
│   │   ├── insights/         # Insights fetch
│   │   ├── nango/            # Nango session token endpoint
│   │   ├── threads/          # HITL approve/reject
│   │   ├── webhooks/clerk/   # Clerk org sync webhook
│   │   └── worker/           # QStash background workers
│   │       ├── graph-build/
│   │       ├── index-delta/
│   │       ├── morning-briefing/
│   │       └── nango-fetch/
│   ├── sign-in/
│   ├── sign-up/
│   └── page.tsx              # Landing page
│
├── lib/
│   ├── agents/               # LangGraph agent implementations
│   │   ├── email-agent.ts
│   │   ├── calendar-agent.ts
│   │   ├── report-agent.ts
│   │   ├── data-index-agent.ts
│   │   ├── retrieval-agent.ts
│   │   ├── synthesis-agent.ts
│   │   └── cross-dept-agent.ts
│   ├── ai/                   # OpenAI embedder
│   ├── auth/                 # Clerk RBAC helpers
│   ├── config/               # App URL, env validation
│   ├── integrations/         # Nango fetchers per provider
│   │   ├── google/           # Drive, Gmail, Calendar
│   │   ├── microsoft/        # Graph, Outlook, Calendar, SharePoint
│   │   ├── slack/
│   │   ├── notion/
│   │   ├── hubspot/
│   │   ├── salesforce/
│   │   ├── github/
│   │   ├── linear/
│   │   ├── zendesk/
│   │   ├── jira/
│   │   ├── confluence/
│   │   ├── snowflake/
│   │   ├── indexing.ts       # Chunking + embedding pipeline
│   │   └── retry.ts          # Rate-limit-aware retry helper
│   ├── knowledge-graph/      # KG extraction, storage, querying
│   │   ├── extractor.ts      # Claude Haiku entity extraction
│   │   ├── builder.ts        # Orchestrates extraction + storage
│   │   ├── storage.ts        # kg_nodes / kg_edges upsert
│   │   ├── query.ts          # BFS traversal, node search
│   │   └── community.ts      # Union-find community detection
│   ├── langgraph/            # LangGraph graph + nodes
│   │   ├── graph.ts          # StateGraph assembly
│   │   ├── state.ts          # AtheneState type definition
│   │   ├── checkpointer.ts   # Postgres-backed thread persistence
│   │   ├── llm-factory.ts    # BYOK + platform LLM resolution
│   │   └── nodes/            # supervisor, approval, action-executor
│   ├── nango/                # Nango client with org ownership check
│   ├── qstash/               # QStash publish + signature verify
│   ├── redis/                # Lazy Redis client
│   └── supabase/             # Admin client + RLS client
│
├── supabase/migrations/      # All DB migrations (apply with supabase db push)
├── components/               # UI components (shadcn/ui + custom)
├── middleware.ts             # Clerk auth + RBAC header injection
├── vercel.json               # Vercel function timeouts
└── .env.example              # All required env vars with descriptions
```

---

## 10. Known Constraints

**Vercel function timeout:** Long agent runs (complex multi-hop retrieval + synthesis) can approach the 300s limit on Vercel Pro. If you hit timeouts regularly, consider moving the LangGraph execution to a dedicated backend (e.g. Railway, Fly.io) and keeping only the API gateway on Vercel.

**Supabase connection pooling:** The LangGraph Postgres checkpointer opens direct Postgres connections. On Vercel (serverless), each function invocation may open a new connection. Set `SUPABASE_DB_POOL_MODE=transaction` and use the Supabase connection pooler URL (port 6543) in your checkpointer config if you see connection limit errors at scale.

**OpenAI for embeddings:** The app uses `text-embedding-3-small` (OpenAI) for both indexing and querying. If you switch embedding models, you must re-index all documents — existing embeddings will not match queries from a different model.

**Nango provider setup:** Each data source integration (Google Drive, Slack, etc.) must be manually enabled in the Nango dashboard with the correct OAuth app credentials. There is no automated setup — you'll need a Google Cloud project, Slack app, etc. for each provider you want to support.
