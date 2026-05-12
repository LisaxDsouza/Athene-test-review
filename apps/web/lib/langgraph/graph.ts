/**
 * lib/langgraph/graph.ts
 *
 * Assembles the AtheneState StateGraph and compiles it with the
 * Postgres checkpointer.
 *
 * Node topology (mirrors ATH-21 spec):
 *
 *   START → supervisor ─┬→ retrieval_agent    ─┐
 *                        ├→ cross_dept_agent   ─┤→ supervisor (loop)
 *                        ├→ email_agent        ─┤
 *                        ├→ calendar_agent     ─┤
 *                        ├→ report_agent       ─┤
 *                        ├→ data_index_agent   ─┤
 *                        └→ FINISH ────────────┼→ synthesis_agent → END
 *
 *  Write-action path (HITL):
 *   supervisor → approval_node  ← graph interrupted here
 *              → action_executor → synthesis_agent → END
 *
 * IMPORTANT — node registration order:
 *   LangGraph requires every node to be registered with addNode() BEFORE
 *   any addEdge() / addConditionalEdges() call that references it.
 *   All addNode() calls are therefore grouped first; all addEdge() calls follow.
 *
 * Lazy singleton:
 *   getAgentGraph() is safe to call on every request — compilation only
 *   happens once per process lifetime. A _compilingPromise guard prevents
 *   parallel compilation races on cold start.
 */

import { StateGraph, START, END, type CompiledStateGraph } from "@langchain/langgraph";
import { AtheneState, type ResponseMode } from "./state";
import { getCheckpointer } from "./checkpointer";
import { HumanMessage } from "@langchain/core/messages";
import type { AtheneIdentity } from "@/lib/auth/clerk";
import type { UserAccess as ResourceAccess } from "@/lib/auth/rbac";

// ── Node imports ─────────────────────────────────────────────────────────────────────
import { supervisor }              from "./nodes/supervisor";
import { retrievalAgent }          from "./nodes/retrieval-agent";
import { crossDeptRetrievalAgent } from "./nodes/cross-dept-retrieval";
import { synthesisAgent }          from "./nodes/synthesis-agent";
import { approvalNode }            from "./nodes/async-tool-node";
import { actionExecutorNode }      from "./nodes/action-executor";

// ── Stub factory ─────────────────────────────────────────────────────────────
// Replace each stub as the real node lands in its own ticket.
// The stub logs a warning so it is visible in staging logs immediately.
function stubNode(label: string) {
  return async (state: typeof AtheneState.State): Promise<Partial<typeof AtheneState.State>> => {
    console.warn(`[graph] stub node reached: ${label}`, { org_id: state.org_id });
    return { next: "FINISH" };
  };
}

// ── Compiled graph singleton ────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AtheneGraph = CompiledStateGraph<typeof AtheneState.State, Partial<typeof AtheneState.State>, any>;

let _compiledGraph: AtheneGraph | null = null;
let _compilingPromise: Promise<AtheneGraph> | null = null;

/**
 * Returns the lazily-compiled agent graph.
 * Concurrent calls during cold start share one compilation promise.
 */
export async function getAgentGraph(): Promise<AtheneGraph> {
  if (_compiledGraph)     return _compiledGraph;
  if (_compilingPromise)  return _compilingPromise;

  _compilingPromise = (async (): Promise<AtheneGraph> => {
    const checkpointer = await getCheckpointer();

    const workflow = new StateGraph(AtheneState);

    // ── Step 1: Register ALL nodes before any edges ───────────────────
    // LangGraph validates edge targets against registered nodes at
    // addEdge/addConditionalEdges time — registration must come first.

    workflow.addNode("supervisor",          supervisor);
    workflow.addNode("retrieval_agent",     retrievalAgent);
    workflow.addNode("cross_dept_agent",    crossDeptRetrievalAgent);
    workflow.addNode("email_agent",         stubNode("email_agent"));
    workflow.addNode("calendar_agent",      stubNode("calendar_agent"));
    workflow.addNode("report_agent",        stubNode("report_agent"));
    workflow.addNode("data_index_agent",    stubNode("data_index_agent"));
    // approval_node: graph is interrupted BEFORE this node executes (HITL gate)
    workflow.addNode("approval_node",       approvalNode);
    workflow.addNode("action_executor",     actionExecutorNode);
    workflow.addNode("synthesis_agent",     synthesisAgent);

    // ── Step 2: Wire edges ────────────────────────────────────────────

    workflow.addEdge(START, "supervisor");

    // Supervisor routes to a worker, the HITL path, or terminal synthesis.
    workflow.addConditionalEdges(
      "supervisor",
      (state) => state.next || "FINISH",
      {
        retrieval_agent:  "retrieval_agent",
        cross_dept_agent: "cross_dept_agent",
        email_agent:      "email_agent",
        calendar_agent:   "calendar_agent",
        report_agent:     "report_agent",
        data_index_agent: "data_index_agent",
        // Supervisor routes write-actions to the HITL gate
        action_executor:  "approval_node",
        FINISH:           "synthesis_agent",
      }
    );

    // All worker agents loop back to supervisor for re-routing.
    for (const node of [
      "retrieval_agent",
      "cross_dept_agent",
      "email_agent",
      "calendar_agent",
      "report_agent",
      "data_index_agent",
    ] as const) {
      workflow.addEdge(node, "supervisor");
    }

    // HITL path: approval_node → action_executor → synthesis_agent
    workflow.addEdge("approval_node",   "action_executor");
    workflow.addEdge("action_executor", "synthesis_agent");

    // Synthesis is always the terminal node
    workflow.addEdge("synthesis_agent", END);

    // ── Step 3: Compile ───────────────────────────────────────────────
    const compiled = workflow.compile({
      checkpointer,
      // Pause BEFORE approval_node; /api/agent/approve resumes the thread.
      interruptBefore: ["approval_node"],
    }) as AtheneGraph;

    _compiledGraph    = compiled;
    _compilingPromise = null;
    return compiled;
  })();

  return _compilingPromise;
}

/**
 * Reset the singleton — **test use only**.
 * @internal
 */
export function _resetCompiledGraph(): void {
  _compiledGraph    = null;
  _compilingPromise = null;
}

// ─── Convenience Wrappers ───────────────────────────────────────────────────

/**
 * Creates the initial state for a new graph run.
 */
export function createInitialState(params: {
  prompt: string;
  threadId?: string;
  identity: AtheneIdentity;
  access: ResourceAccess;
  mode?: ResponseMode;
}): typeof AtheneState.State {
  return {
    messages: [new HumanMessage(params.prompt)],
    org_id: params.identity.orgId,
    user_id: params.identity.userId,
    user_role: params.identity.orgRole as any,
    thread_id: params.threadId || crypto.randomUUID(),
    user_dept_id: params.access.deptId || null,
    accessible_dept_ids: params.access.accessibleDeptIds,
    bi_grant_id: params.access.biGrantId || null,
    // Defaults
    next: "supervisor",
    hop_count: 0,
    retrieved_chunks: [],
    cited_sources: [],
    final_answer: null,
    is_cross_dept_query: false,
    active_agent: null,
    task_type: null,
    complexity: "simple",
    reasoning: "",
    pending_tool_calls: [],
    run_status: "running",
    awaiting_approval: false,
    pending_write_action: null,
    response_mode: params.mode ?? "chat",
    community_ids: [],
    graph_context: "",
  };
}

/**
 * Executes the graph and yields stream events.
 */
export async function* runAtheneGraph(state: typeof AtheneState.State) {
  const graph = await getAgentGraph();
  const stream = await graph.stream(state, {
    configurable: { thread_id: state.thread_id },
    streamMode: "values",
  });

  for await (const chunk of stream) {
    // Transform or filter events if needed before yielding
    yield chunk;
  }
}