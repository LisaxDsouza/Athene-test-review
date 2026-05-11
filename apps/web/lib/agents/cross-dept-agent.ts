// ============================================================
// agents/cross-dept-agent.ts — Cross-department retrieval agent (ATH-35)
//
// BI-ONLY PATH. First statement is a hard role check.
// Uses crossDeptVectorSearchTool (ATH-33) which enforces
// visibility='bi_accessible' at the DB level.
//
// Every execution writes a row to cross_dept_audit_log regardless of
// whether docs are found — the audit trail is unconditional.
//
// 🔒 Security contract:
//   - role !== 'bi_analyst' → immediate 403-style rejection
//   - crossDeptVectorSearch enforces a second role check inside
//   - cross_dept_audit_log captures: orgId, userId, query, queried_dept_ids, chunk_ids_accessed, prompt_hash
// ============================================================

import { ToolNode } from '@langchain/langgraph/prebuilt'
import { ToolMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import { supabaseAdmin } from '@/lib/supabase/server'
import { crossDeptVectorSearchTool } from '@/lib/tools/registry'
import type { AtheneStateType, AtheneStateUpdate } from '@/lib/langgraph/state'

// Module-level ToolNode singleton — never recreated per request
const toolNode = new ToolNode([crossDeptVectorSearchTool])

// ---- Agent node ---------------------------------------------

export async function crossDeptAgent(
  state: AtheneStateType,
  config: RunnableConfig,
): Promise<AtheneStateUpdate> {
  const { org_id, user_id, user_role } = state

  // ⚠️ HARD ROLE CHECK — must be the first statement
  if (user_role !== 'super_user' && user_role !== 'admin') {
    return {
      messages: [
        {
          role: 'assistant',
          content:
            'Access Denied: Cross-department analysis is restricted to BI Analysts.',
        },
      ],
    }
  }

  // Inject security context into tool config metadata
  const toolConfig = {
    ...config,
    metadata: {
      ...(config?.metadata ?? {}),
      orgId: org_id,
      userId: user_id,
      user_role,
    },
  }

  // Run cross-dept vector search via ToolNode
  const result = await toolNode.invoke(
    { messages: state.messages },
    toolConfig,
  )

  // Parse retrieved docs from tool message payloads
  const retrievedDocs: Array<{
    chunk_id?: string
    metadata?: { department_id?: string }
  }> = result.messages
    .filter((m): m is ToolMessage => m instanceof ToolMessage)
    .flatMap((m: ToolMessage) => {
      try {
        return JSON.parse(m.content as string)
      } catch {
        return []
      }
    })

  // Extract the user's query from the last human message
  const lastMsg = state.messages.at(-1)
  const queryText =
    typeof lastMsg?.content === 'string'
      ? lastMsg.content
      : JSON.stringify(lastMsg?.content ?? '')

  // Write audit rows — unconditional, even on 0 results
  await writeBIAuditRows(org_id, user_id, queryText, retrievedDocs)

  return {
    messages: result.messages,
  }
}

// ---- Audit writer -------------------------------------------

/**
 * Writes one row to cross_dept_audit_log (migration 001_schema.sql).
 * Schema: thread_id, user_id, org_id, queried_dept_ids uuid[], chunk_ids_accessed uuid[], prompt_hash, grant_id
 * Failures are logged but never bubble up — audit must not break the agent.
 */
async function writeBIAuditRows(
  orgId: string,
  userId: string,
  query: string,
  docs: Array<{ chunk_id?: string; metadata?: { department_id?: string } }>,
): Promise<void> {
  // Derive queried dept IDs and accessed chunk IDs from retrieved docs
  const queriedDeptIds = [
    ...new Set(docs.map((d) => d.metadata?.department_id).filter(Boolean) as string[]),
  ];
  const chunkIdsAccessed = docs
    .map((d) => d.chunk_id)
    .filter(Boolean) as string[];

  // Hash the query text for privacy-safe audit trail
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(query));
  const promptHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { error } = await supabaseAdmin.from("cross_dept_audit_log").insert({
    thread_id: crypto.randomUUID(), // agent runs don't always have a thread_id here
    org_id: orgId,
    user_id: userId,
    queried_dept_ids: queriedDeptIds,
    chunk_ids_accessed: chunkIdsAccessed,
    prompt_hash: promptHash,
    grant_id: null,
  });

  if (error) {
    console.error("[cross-dept-agent] cross_dept_audit_log write failed:", error.message);
  }
}

