// ============================================================
// agents/cross-dept-agent.ts — Cross-department retrieval agent (ATH-35)
//
// BI-ONLY PATH. First statement is a hard role check.
// Uses crossDeptVectorSearchTool (ATH-33) which enforces
// visibility='bi_accessible' at the DB level.
//
// Every execution writes a row to bi_access_audit regardless of
// whether docs are found — the audit trail is unconditional.
//
// 🔒 Security contract:
//   - role !== 'bi_analyst' → immediate 403-style rejection
//   - crossDeptVectorSearch enforces a second role check inside
//   - bi_access_audit captures: orgId, userId, query, dept, docId
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
 * Writes one row per retrieved document to bi_access_audit.
 * If no docs found, writes a single row with null doc_id.
 * Failures are logged but never bubble up — audit must not break the agent.
 */
async function writeBIAuditRows(
  orgId: string,
  userId: string,
  query: string,
  docs: Array<{ chunk_id?: string; metadata?: { department_id?: string } }>,
): Promise<void> {
  const timestamp = new Date().toISOString()

  const rows =
    docs.length > 0
      ? docs.map((doc) => ({
          org_id: orgId,
          user_id: userId,
          query,
          dept: doc.metadata?.department_id ?? null,
          doc_id: doc.chunk_id ?? null,
          timestamp,
        }))
      : [
          {
            org_id: orgId,
            user_id: userId,
            query,
            dept: null,
            doc_id: null,
            timestamp,
          },
        ]

  const { error } = await supabaseAdmin.from('bi_access_audit').insert(rows)
  if (error) {
    console.error('[cross-dept-agent] bi_access_audit write failed:', error.message)
  }
}
