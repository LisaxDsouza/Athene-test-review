/**
 * lib/langgraph/nodes/synthesis-agent.ts
 *
 * Thin LangGraph node wrapper for the synthesis agent.
 *
 * The actual synthesis logic (prompt construction, citation extraction,
 * ephemeral chunk clearing) lives in lib/agents/synthesis-agent.ts.
 * This file exists only to provide the standard node signature and to
 * tag `active_agent` in the returned state update.
 */

import type { AtheneStateType, AtheneStateUpdate } from "../state";
import { synthesisAgentNode as implementation } from "@/lib/agents/synthesis-agent";

export async function synthesisAgent(
  state: AtheneStateType,
): Promise<AtheneStateUpdate> {
  const update = await implementation(state);
  return {
    ...update,
    active_agent: "synthesis",
    run_status:   "completed",
  };
}
