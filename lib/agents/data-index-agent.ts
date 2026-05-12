// ============================================================
// agents/data-index-agent.ts — Data Index Agent (ATH-41)
//
// Resolves which documents the user wants re-indexed, queues
// them via the index-delta worker, and sets pending_write_action
// for HITL approval (registry: needsApproval = true).
//
// Flow:
//   1. Extract source/document intent from conversation
//   2. Look up matching document IDs in the documents table
//   3. Set pending_write_action so approval_node pauses the graph
//   4. After approval: action_executor dispatches to /api/worker/index-delta
// ============================================================

import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { resolveModelClient } from "../langgraph/llm-factory";
import { supabaseAdmin } from "../supabase/server";
import type { AtheneStateType, AtheneStateUpdate } from "../langgraph/state";

const SYSTEM_PROMPT = `You are the Athene AI Data Index Agent.

Your job is to determine which data sources or documents the user wants to re-index
based on their request and the conversation context.

Return ONLY a valid JSON object — no markdown fences, no commentary.

Output schema:
{
  "source_filter": "all" | "connection_name" | "document_title_keyword",
  "department_hint": "department name or null",
  "reason": "one-sentence explanation of what will be re-indexed"
}

Examples:
- "re-index everything" → { "source_filter": "all", "department_hint": null, "reason": "Re-index all documents in the organization." }
- "reindex the Google Drive docs" → { "source_filter": "google-drive", "department_hint": null, "reason": "Re-index all Google Drive documents." }
- "update the Product team knowledge base" → { "source_filter": "all", "department_hint": "Product", "reason": "Re-index all Product team documents." }`;

interface IndexIntent {
  source_filter: string;
  department_hint: string | null;
  reason: string;
}

function parseIntent(raw: string): IndexIntent {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text);
    return {
      source_filter: typeof parsed.source_filter === "string" ? parsed.source_filter : "all",
      department_hint: typeof parsed.department_hint === "string" ? parsed.department_hint : null,
      reason: typeof parsed.reason === "string" ? parsed.reason : "Re-index documents.",
    };
  } catch {
    return { source_filter: "all", department_hint: null, reason: "Re-index all documents." };
  }
}

export async function dataIndexAgent(
  state: AtheneStateType,
): Promise<AtheneStateUpdate> {
  // 1. Extract intent from conversation
  const history = state.messages
    .map((m) => {
      const role = m instanceof HumanMessage ? "human" : m instanceof AIMessage ? "assistant" : "tool";
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${role}: ${content}`;
    })
    .join("\n");

  const { client: llm } = await resolveModelClient(state.org_id, state.complexity ?? "simple");
  const response = await llm.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Conversation:\n${history}\n\nWhat should be re-indexed?` },
  ]);

  const raw = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  const intent = parseIntent(raw);

  // 2. Resolve matching document IDs from Supabase
  let query = supabaseAdmin
    .from("documents")
    .select("id, title, source_type")
    .eq("org_id", state.org_id);

  if (intent.source_filter !== "all") {
    query = query.ilike("source_type", `%${intent.source_filter}%`);
  }

  if (intent.department_hint) {
    // Look up the department UUID by name
    const { data: dept } = await supabaseAdmin
      .from("departments")
      .select("id")
      .eq("org_id", state.org_id)
      .ilike("name", `%${intent.department_hint}%`)
      .maybeSingle();

    if (dept?.id) {
      query = query.eq("department_id", dept.id);
    }
  }

  const { data: docs, error } = await query.limit(500);

  if (error) {
    console.error("[data-index-agent] Failed to resolve documents:", error.message);
  }

  const documentIds = (docs ?? []).map((d) => d.id);
  const docCount = documentIds.length;

  if (docCount === 0) {
    return {
      next: "FINISH",
      final_answer: "No matching documents found to re-index. Please check that the data source is connected and has been indexed at least once.",
    };
  }

  // 3. Set pending_write_action — approval_node will pause the graph here
  return {
    run_status: "awaiting_approval",
    awaiting_approval: true,
    pending_write_action: {
      tool: "data-index",
      payload: {
        org_id: state.org_id,
        document_ids: documentIds,
        reason: intent.reason,
        doc_count: docCount,
      },
      requested_at: new Date().toISOString(),
    },
  };
}
