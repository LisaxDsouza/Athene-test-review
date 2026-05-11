# Athene — Pre-Deployment Issue Log

Audit date: 2026-05-11  
Audited by: Senior engineering review (automated + manual)  
Branch: `main` → fork `mudxssir/Athene-test-review`

---

## Severity Legend

| Label | Meaning |
|---|---|
| 🔴 P0 | Will cause immediate failure in production — fix before any deploy |
| 🟠 P1 | Auth / security flows broken at runtime |
| 🟡 P2 | Feature broken but core chat path unaffected |
| 🔵 P3 | UI stub / informational / nice-to-have |

---

## 🔴 P0 — Immediate Failures

### 1. Chat page calls wrong API URL
**File:** `app/(dashboard)/chat/page.tsx:45`  
**Issue:** `fetch("/api/agent/route")` — no handler exists at that path. The actual endpoint is `/api/agent`.  
**Impact:** Every chat message submission returns 404. Core product is broken.  
**Fix:** Change fetch URL to `/api/agent`.

---

### 2. Redis crashes on cold start if env vars missing
**File:** `lib/redis/client.ts:3`  
**Issue:** `Redis.fromEnv()` is called at module load time (not inside a function). If `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` are absent, the process throws synchronously. Because this module is imported by `lib/auth/rbac.ts` and `lib/qstash/client.ts`, **every route** that uses auth or QStash will 500 on cold start.  
**Fix:** Wrap in a lazy getter function so evaluation is deferred until first call.

---

### 3. `vector_search` Postgres function does not exist
**File:** `lib/tools/vector-search.ts:37`  
**Issue:** Code calls `supabaseAdmin.rpc('vector_search', { p_embedding, p_limit })`. The migration `20260101000008_rls_helpers.sql` defines `match_documents` (different name, different signature). No migration creates `vector_search`.  
**Impact:** Every vector search — the core retrieval step of every agent query — fails with a Postgres error.  
**Fix:** Add a migration that creates `vector_search(p_org_id, p_user_id, p_embedding, p_limit)` wrapping `match_documents`, or update the TS code to call `match_documents` with the correct args.

---

### 4. `vector_search_cross_dept` Postgres function does not exist
**File:** `lib/tools/vector-search.ts:66`  
**Issue:** Code calls `supabaseAdmin.rpc('vector_search_cross_dept', ...)`. No migration defines this function.  
**Impact:** All cross-department search (bi_analyst / admin) fails.  
**Fix:** Add a migration defining `vector_search_cross_dept`.

---

### 5. `store_llm_key` Postgres function does not exist
**File:** `app/api/admin/keys/route.ts:55`  
**Issue:** `POST /api/admin/keys` calls `supabaseAdmin.rpc('store_llm_key', { p_org_id, p_provider, p_plaintext, p_kms_key })`. Migration `20260101000005_org_api_keys.sql` defines `encrypt_llm_key` and `decrypt_llm_key` — not `store_llm_key`.  
**Impact:** Every BYOK key submission returns 500. No org can add their own LLM API key.  
**Fix:** Add a migration creating `store_llm_key(p_org_id, p_provider, p_plaintext, p_kms_key)` that upserts into `llm_keys` using `pgp_sym_encrypt`.

---

### 6. `get_decrypted_llm_key` Postgres function does not exist
**File:** `lib/langgraph/llm-factory.ts:124`  
**Issue:** BYOK lookup calls `supabaseAdmin.rpc('get_decrypted_llm_key', { p_org_id, p_kms_key })`. Only `decrypt_llm_key(encrypted_key bytea)` exists — different name and signature.  
**Impact:** BYOK never works; all orgs silently fall back to platform API keys. Error is swallowed with a console.warn.  
**Fix:** Add a migration creating `get_decrypted_llm_key(p_org_id, p_kms_key)` that selects and decrypts the active key for an org.

---

### 7. Duplicate / conflicting migration sets — fresh deploy will fail
**Files:** `supabase/migrations/001_schema.sql` through `007_user_automations.sql` and `20260101000001_schema.sql` through `20260416000000_pending_background_jobs.sql`  
**Issue:** Both sets create the same tables (`organizations`, `departments`, `org_members`, etc.). Supabase runs migrations alphabetically, so `001_schema.sql` runs first and creates the tables. Then `20260101000001_schema.sql` tries `CREATE TABLE organizations` (no `IF NOT EXISTS`) and **fails**. The entire new migration set is never applied on a fresh database.  
**Impact:** On any fresh Supabase project: `organizations`, `threads`, `hitl_decisions`, `llm_keys`, `nango_connections`, `automations`, `briefings`, `insights`, all new RLS policies, all vector search helpers — none of these are created.  
**Fix:** Either delete the `001–007` numbered files (if the timestamped set is canonical) or add `IF NOT EXISTS` guards to every `CREATE TABLE` in `20260101000001_schema.sql`.

---

### 8. `audit_logs` table does not exist
**File:** `app/api/admin/audit-log/route.ts:14`  
**Issue:** Queries `.from('audit_logs')`. No migration creates this table.  
**Impact:** The admin audit log page always returns a Postgres error (500).  
**Fix:** Add a migration for `audit_logs(id, org_id, user_id, action, metadata, created_at)`, or point the query at `cross_dept_audit_log` which does exist.

---

### 9. `bi_access_audit` table does not exist
**File:** `lib/agents/cross-dept-agent.ts:126`  
**Issue:** Agent writes to `bi_access_audit` after every cross-dept query. No migration creates this table. The error is caught and logged — so the agent doesn't crash, but the write silently fails.  
**Fix:** Add a migration for `bi_access_audit`, or rename the reference to the existing `cross_dept_audit_log` table.

---

## 🟠 P1 — Auth / Security Flows Broken at Runtime

### 10. Resume route reads wrong state field names (camelCase vs snake_case)
**File:** `app/api/agent/resume/route.ts:28,31,34`  
**Issue:** Reads `state.orgId` and `state.userId` but `AtheneState` defines `org_id` and `user_id` (snake_case). Both always return `undefined`, so the ownership check always fails.  
**Impact:** `POST /api/agent/resume` always returns 404 "Thread not found." Resuming an interrupted agent (HITL) is completely broken.  
**Fix:** Change `state.orgId` → `state.org_id` and `state.userId` → `state.user_id`.

---

### 11. Resume route checks wrong `run_status` value
**File:** `app/api/agent/resume/route.ts:37`  
**Issue:** Checks `state.run_status !== 'paused'`. `'paused'` is not a valid value in `AtheneState` — the valid values are `'idle' | 'running' | 'awaiting_approval' | 'completed' | 'failed'`. This condition is always true.  
**Impact:** `POST /api/agent/resume` always returns 409 "Thread is not awaiting approval."  
**Fix:** Change check to `state.run_status !== 'awaiting_approval'`.

---

### 12. Approve route reads wrong state field names (camelCase vs snake_case)
**File:** `app/api/threads/[id]/approve/route.ts:93`  
**Issue:** Reads `stateValues.orgId` and `stateValues.userId` (camelCase). State uses snake_case.  
**Impact:** `POST /api/threads/[id]/approve` always returns 403 "Access denied." The entire HITL approval flow is broken.  
**Fix:** Change to `stateValues.org_id` and `stateValues.user_id`.

---

### 13. `withRLS` always sets user role to `'member'`
**File:** `lib/supabase/rls-client.ts:29`  
**Issue:** Calls `set_app_context(p_org_id, p_user_id)` with only 2 of 4 args. `p_role` defaults to `'member'`. RLS policies that check `current_setting('app.user_role')` will deny admin/bi_analyst users access to their permitted data.  
**Impact:** Admin and bi_analyst users can't access department-filtered or role-restricted data through the RLS client.  
**Fix:** Pass `p_dept_id: ctx.department_id ?? ''` and `p_role: ctx.user_role ?? 'member'` to the RPC call.

---

### 14. `has_session_grants()` called but never defined
**File:** `supabase/migrations/20260101000002_rls_policies.sql:83`  
**Issue:** `has_any_department_grant()` calls `has_session_grants()` internally, but no migration defines `has_session_grants()`.  
**Impact:** Any RLS policy that invokes `has_any_department_grant()` throws "function has_session_grants() does not exist" — blocking all bi_analyst cross-dept access checks at the DB level.  
**Fix:** Add a migration defining `has_session_grants()` that reads from the session grants set by `set_session_grants()`.

---

### 15. `logHitlDecision` inserts Clerk string IDs into UUID FK columns
**File:** `lib/graph/interrupts.ts:116`  
**Issue:** Inserts `thread_id: params.threadId` (a LangGraph string like `"thread-1234567890"`) and `user_id: params.userId` (a Clerk ID like `"user_abc123"`) into `hitl_decisions`, whose schema defines both as `uuid` FK columns.  
**Impact:** Every HITL approval log insert fails with a Postgres UUID cast error.  
**Fix:** Either change `hitl_decisions.thread_id` and `hitl_decisions.user_id` to `text` in the migration, or resolve the Clerk/LangGraph IDs to their corresponding UUIDs before inserting.

---

## 🟡 P2 — Features Broken, Core Path Unaffected

### 16. `NEXT_PUBLIC_APP_URL` missing from `.env.example`
**File:** `lib/config/app-url.ts:2`  
**Issue:** `getAppBaseUrl()` reads `process.env.NEXT_PUBLIC_APP_URL` and throws if absent or invalid. This var is used when building QStash callback URLs in `nango-fetch`, `index-delta`, and `connections/sync`. It is not in `.env.example`.  
**Impact:** On any deploy without this var, sync triggering and graph-build enqueuing silently throw. The connection indexing flow never starts.  
**Fix:** Add `NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app` to `.env.example` with a comment that it must be HTTPS and set manually in Vercel dashboard.

---

### 17. Morning briefing route exports `GET` instead of `POST`
**File:** `app/api/worker/morning-briefing/route.ts`  
**Issue:** Exports `async function GET()` returning 501. QStash invokes workers via `POST`. The route also has no cron schedule configured anywhere in the repo.  
**Impact:** The morning briefing feature cannot be triggered by QStash. Even if called manually it returns 501.  
**Fix:** Change to `POST`, implement the briefing logic, and document the QStash cron schedule configuration (`QSTASH_CRON_BRIEFING` or similar) needed to trigger it daily.

---

### 18. Nango `nangoKey` in UI does not match `providerFetcherMap` keys in worker
**Files:** `app/(dashboard)/admin/integrations/page.tsx`, `app/api/worker/nango-fetch/route.ts`  
**Issue:** The UI connects Google using `nangoKey: "google"`, but the worker's `providerFetcherMap` has no `"google"` key — it has `"google-drive"`, `"gmail"`, and `"google-calendar"` separately. Same issue for `"microsoft"` vs `"microsoft-graph"`. When `POST /api/connections/sync` dispatches the job with `provider: "google"`, the worker returns 400 "Unknown provider."  
**Impact:** Google Workspace and Microsoft 365 connections never get indexed after connecting.  
**Fix:** Either add a compound key lookup in the worker (`"google"` fans out to all three Google fetchers), or update the UI to use the exact provider-level keys and connect them separately.

---

### 19. No `nango.yaml` — Nango dashboard must be manually configured
**Issue:** There is no `nango.yaml` or equivalent configuration file in the repo. All 14 provider integrations (Google, Slack, Notion, GitHub, etc.) must be manually created in the Nango dashboard with matching `provider_config_key` values before any OAuth flow works.  
**Impact:** A fresh deployment has zero working integrations with no in-repo documentation of what needs to be configured.  
**Fix:** Add a `nango.yaml` (or a `docs/nango-setup.md`) documenting every required provider config key, scopes, and callback URL.

---

### 20. `index-delta` worker is never triggered
**File:** `app/api/worker/index-delta/route.ts`  
**Issue:** Nothing in the codebase dispatches a job to `/api/worker/index-delta`. It is referenced only in its own comments as an "ATH-44 path." The `nango-fetch` worker goes directly to `graph-build` after indexing.  
**Impact:** The endpoint is dead code. Force-reindex functionality doesn't exist.  
**Fix:** Either wire it from an admin UI action ("Re-index all documents"), or remove it if no longer needed.

---

## 🔵 P3 — UI Stubs / Informational

### 21. Admin keys page is a "Coming soon" stub
**File:** `app/(dashboard)/admin/keys/page.tsx`  
**Issue:** Renders placeholder text. `GET` and `POST /api/admin/keys` are fully implemented but the UI never calls them. BYOK key management is unreachable from the interface.

---

### 22. Admin grants page is a "Coming soon" stub
**File:** `app/(dashboard)/admin/grants/page.tsx`  
**Issue:** Renders placeholder text. `GET`, `POST`, `DELETE /api/admin/bi-grants` are fully implemented but never called from this page.

---

### 23. Admin automations page is a "Coming soon" stub
**File:** `app/(dashboard)/admin/automations/page.tsx`  
**Issue:** Renders placeholder text. `GET`, `POST`, `DELETE /api/admin/automations` are implemented but not wired.

---

### 24. Briefing page is a stub
**File:** `app/(dashboard)/briefing/page.tsx`  
**Issue:** Renders placeholder text. No API call. Blocked by issue #17 (morning-briefing worker stub).

---

### 25. Insights page is a stub
**File:** `app/(dashboard)/insights/page.tsx`  
**Issue:** Renders placeholder text. No API call or backend.

---

### 26. Chat page has no HITL approval UI
**File:** `app/(dashboard)/chat/page.tsx`  
**Issue:** No polling of `/api/agent/status`, no detection of `awaiting_approval: true`, no approve/reject buttons. Even after P1 issues are fixed, users would never see or be able to respond to HITL approval prompts.  
**Fix:** Add status polling and an inline approval card to the chat UI.

---

### 27. Cross-dept agent role check contradicts its own comment
**File:** `lib/agents/cross-dept-agent.ts:12,36`  
**Issue:** Comment says `bi_analyst` users are allowed; implementation returns 403 for `bi_analyst`. The `AGENT_REGISTRY` correctly allows `bi_analyst` but the in-agent check overrides it.  
**Fix:** Remove the redundant in-agent role check (the registry check in the supervisor already handles this), or fix the condition to match the intended policy.

---

## Summary Table

| # | Severity | Area | One-line description |
|---|---|---|---|
| 1 | 🔴 P0 | Chat UI | Wrong API URL — every message is a 404 |
| 2 | 🔴 P0 | Redis | Module-load crash if env vars missing |
| 3 | 🔴 P0 | DB | `vector_search` RPC doesn't exist — retrieval broken |
| 4 | 🔴 P0 | DB | `vector_search_cross_dept` RPC doesn't exist |
| 5 | 🔴 P0 | DB | `store_llm_key` RPC doesn't exist — BYOK write broken |
| 6 | 🔴 P0 | DB | `get_decrypted_llm_key` RPC doesn't exist — BYOK read broken |
| 7 | 🔴 P0 | DB | Duplicate migrations conflict — fresh deploy schema incomplete |
| 8 | 🔴 P0 | DB | `audit_logs` table missing |
| 9 | 🔴 P0 | DB | `bi_access_audit` table missing |
| 10 | 🟠 P1 | Resume | `state.orgId` should be `state.org_id` — always 404 |
| 11 | 🟠 P1 | Resume | Checks `'paused'` instead of `'awaiting_approval'` — always 409 |
| 12 | 🟠 P1 | Approve | `stateValues.orgId` should be `state.org_id` — always 403 |
| 13 | 🟠 P1 | RLS | `withRLS` passes only 2 args — role always `'member'` |
| 14 | 🟠 P1 | RLS | `has_session_grants()` called but never defined |
| 15 | 🟠 P1 | HITL | Clerk string IDs inserted into UUID FK columns |
| 16 | 🟡 P2 | Config | `NEXT_PUBLIC_APP_URL` missing from `.env.example` |
| 17 | 🟡 P2 | Briefing | Morning briefing is GET + stub, should be POST |
| 18 | 🟡 P2 | Nango | UI nangoKey `"google"` has no match in providerFetcherMap |
| 19 | 🟡 P2 | Nango | No `nango.yaml` — dashboard must be manually configured |
| 20 | 🟡 P2 | Worker | `index-delta` worker is never triggered (dead endpoint) |
| 21 | 🔵 P3 | UI | Admin keys page stub |
| 22 | 🔵 P3 | UI | Admin grants page stub |
| 23 | 🔵 P3 | UI | Admin automations page stub |
| 24 | 🔵 P3 | UI | Briefing page stub |
| 25 | 🔵 P3 | UI | Insights page stub |
| 26 | 🔵 P3 | UI | Chat has no HITL approval UI |
| 27 | 🔵 P3 | Agent | Cross-dept agent role check contradicts registry |
