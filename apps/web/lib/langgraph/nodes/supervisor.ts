/**
 * lib/langgraph/nodes/supervisor.ts
 *
 * Supervisor node — the single entry point for every user request.
 *
 * Responsibilities:
 *  1. Guard against infinite loops via hop_count (MAX_HOPS = 6).
 *  2. Call the LLM with structured output to classify task and route.
 *  3. Enforce RBAC: downgrade cross-dept routes if role is insufficient.
 *  4. Write `active_agent` (short name, for UI/logs) and `next` (full
 *     graph node name, drives conditional edges in graph.ts).
 *
 * State fields written:
 *   active_agent      — short routing label: "retrieval" | "email" | … | "END"
 *   next              — full graph node name: "retrieval_agent" | … | "FINISH"
 *   task_type         — LLM-classified task category
 *   complexity        — LLM-classified tier
 *   hop_count         — incremented by 1
 *   reasoning         — LLM's routing rationale (audit trail)
 *   is_cross_dept_query — true only when cross-dept agent is selected
 *
 * Routing contract with graph.ts:
 *   conditional edge reads state.next; the map keys match exactly the
 *   values this node emits ("retrieval_agent", "cross_dept_agent", …,
 *   "FINISH"). The "FINISH" key routes to synthesis_agent.
 */

import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import type { AtheneStateType, AtheneStateUpdate } from "../state";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard cap on supervisor→agent hops per run. Prevents runaway loops. */
const MAX_HOPS = 6;

// ─── Structured output schema ─────────────────────────────────────────────────

/**
 * The six short agent targets the LLM may choose.
 * Must stay in sync with the AGENT_NODE_MAP below.
 */
const AGENT_ENUM = [
  "retrieval",
  "cross_dept_retrieval",
  "email",
  "calendar",
  "report",
  "data_index",
  "synthesis",
] as const;

type AgentTarget = typeof AGENT_ENUM[number];

const routingSchema = z.object({
  /** Short agent name chosen by the LLM */
  next_agent:  z.enum(AGENT_ENUM),
  /** Classifier label for the request (free-form string) */
  task_type:   z.string(),
  /** Model tier the supervisor assigns to this request */
  complexity:  z.enum(["simple", "medium", "complex"] as const),
  /** Plain-English rationale written to the audit trail */
  reasoning:   z.string(),
});

// ─── LLM singleton (lazy — module load is safe with no API key) ───────────────

let _llm: ReturnType<typeof ChatOpenAI.prototype.withStructuredOutput> | null = null;

function getLLM(): ReturnType<typeof ChatOpenAI.prototype.withStructuredOutput> {
  if (!_llm) {
    const chat = new ChatOpenAI({ modelName: "gpt-4o", temperature: 0 });
    _llm = chat.withStructuredOutput(routingSchema);
  }
  return _llm;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Supervisor for Athene, an enterprise AI assistant.
Classify the user's latest request and route it to the correct specialist agent.

Available agents:
- retrieval          General document/knowledge search within the user's department.
- cross_dept_retrieval Cross-department BI analysis (elevated role required).
- email              Draft, read, or send emails.
- calendar           Schedule, read, or manage calendar events.
- report             Generate structured reports from already-retrieved data.
- data_index         Index or re-index documents into the knowledge base.
- synthesis          Synthesise / summarise when enough context has been gathered.

Use "synthesis" when retrieved_chunks already contains sufficient information to answer.`;

// ─── Short name → graph node name map ────────────────────────────────────────

/**
 * Maps the LLM's short agent name to the graph node name used by graph.ts
 * conditional edges.  "synthesis" maps to "FINISH" so the conditional edge
 * routes to synthesis_agent via the FINISH key.
 */
const NEXT_MAP: Record<AgentTarget, string> = {
  retrieval:           "retrieval_agent",
  cross_dept_retrieval: "cross_dept_agent",
  email:               "email_agent",
  calendar:            "calendar_agent",
  report:              "report_agent",
  data_index:          "data_index_agent",
  synthesis:           "FINISH",
} as const;

// ─── Node ─────────────────────────────────────────────────────────────────────

/**
 * Supervisor node.
 *
 * Increments hop_count, enforces the hop cap, invokes the LLM for routing,
 * enforces RBAC, then returns the state update that drives graph traversal.
 */
export async function supervisor(
  state: AtheneStateType,
): Promise<AtheneStateUpdate> {
  const hopCount = (state.hop_count ?? 0) + 1;

  // ── 1. Hard loop guard ───────────────────────────────────────────────────
  if (state.hop_count >= MAX_HOPS) {
    return {
      active_agent: "END",
      next:         "FINISH",
      hop_count:    hopCount,
      reasoning:    `Max hop limit (${MAX_HOPS}) reached — terminating run.`,
      run_status:   "running",
    };
  }

  // ── 2. LLM routing decision ──────────────────────────────────────────────
  const rawDecision = await getLLM().invoke([
    { role: "system", content: SYSTEM_PROMPT },
    ...state.messages,
  ]);

  const decision = rawDecision as {
    next_agent: AgentTarget;
    task_type: string;
    complexity: "simple" | "medium" | "complex";
    reasoning: string;
  };

  // ── 3. RBAC guard — downgrade cross-dept if role is insufficient ─────────
  let nextAgent: AgentTarget  = decision.next_agent;
  let isCrossDept             = nextAgent === "cross_dept_retrieval";
  let reasoning               = decision.reasoning;
  let taskType                = decision.task_type;

  if (isCrossDept && state.user_role === "member") {
    nextAgent   = "retrieval";
    isCrossDept = false;
    taskType    = "document_search";
    reasoning   =
      `[Guard] Downgraded cross_dept_retrieval → retrieval: ` +
      `role '${state.user_role}' is insufficient. Original: ${reasoning}`;
  }

  // ── 4. Build state update ────────────────────────────────────────────────
  return {
    active_agent:        nextAgent as AtheneStateType["active_agent"],
    next:                NEXT_MAP[nextAgent],
    task_type:           taskType as AtheneStateType["task_type"],
    complexity:          decision.complexity,
    hop_count:           hopCount,
    reasoning,
    is_cross_dept_query: isCrossDept,
    run_status:          "running",
  };
}
