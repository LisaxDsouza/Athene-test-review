/**
 * lib/langgraph/nodes/retrieval-agent.ts
 *
 * Standard retrieval agent worker node.
 *
 * Delegates to the `lib/agents/retrieval-agent` implementation which
 * performs the RLS-protected vector search. This thin wrapper is
 * responsible only for adapting the node signature (state + config)
 * and updating `active_agent` on the state after the call.
 *
 * No `any`. Security context comes exclusively from the verified identity
 * fields in AtheneState (org_id, user_id, user_role) — never from
 * user-controlled input.
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import type { AtheneStateType, AtheneStateUpdate } from "../state";
import { retrievalAgent as retrievalAgentImpl } from "@/lib/agents/retrieval-agent";

/**
 * LangGraph node wrapper for the retrieval agent.
 * Forwards state to the implementation and returns the state update.
 */
export async function retrievalAgent(
  state: AtheneStateType,
  _config: RunnableConfig,
): Promise<AtheneStateUpdate> {
  const update = await retrievalAgentImpl(state);
  return {
    ...update,
    active_agent: "retrieval",
  };
}
