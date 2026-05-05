/**
 * lib/langgraph/nodes/cross-dept-retrieval.ts
 *
 * Cross-department retrieval agent worker node.
 *
 * Delegates to the `lib/agents/cross-dept-agent` implementation which
 * enforces the BI role check and writes the bi_access_audit trail.
 * This thin wrapper adapts the LangGraph node signature (state + config)
 * and tags `active_agent` on the returned state update.
 *
 * No `any`. Security context comes exclusively from verified identity
 * fields in AtheneState (org_id, user_id, user_role).
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import type { AtheneStateType, AtheneStateUpdate } from "../state";
import { crossDeptAgent } from "@/lib/agents/cross-dept-agent";

/**
 * LangGraph node wrapper for the cross-department retrieval agent.
 * The role check happens inside `crossDeptAgent` (first statement).
 * We re-inject the config so the underlying ToolNode can access it.
 */
export async function crossDeptRetrievalAgent(
  state: AtheneStateType,
  config: RunnableConfig,
): Promise<AtheneStateUpdate> {
  const update = await crossDeptAgent(state, config);
  return {
    ...update,
    active_agent: "cross_dept_retrieval",
  };
}
