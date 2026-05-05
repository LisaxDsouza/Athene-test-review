// ============================================================
// nodes/async-tool-node.ts — Approval / HITL node (ATH-43)
//
// This node sits behind interrupt_before in the compiled graph.
// LangGraph pauses execution BEFORE this node runs. The human
// reviews the pending_write_action and calls POST /api/threads/
// [id]/approve. The approve route updates the checkpoint state
// with the decision, then resumes the graph so this node executes.
//
// By the time this node runs, the state already contains:
//   - awaiting_approval: still true (we clear it here)
//   - pending_write_action: the original or edited payload
//   - _hitl_approved: boolean injected by the resume call
//
// If approved → the actual send/create happens downstream
//   (Nango integration, not in this node).
// If rejected → we null out the pending action and move on.
// ============================================================

import type { AtheneStateType, AtheneStateUpdate } from "../state";

/**
 * approval_node — executes after the human decision is injected.
 *
 * The approve/reject API route resumes the graph with updated state.
 * This node clears the HITL gate and lets the graph continue to
 * synthesis_agent.
 */
export async function approvalNode(
  state: AtheneStateType,
): Promise<AtheneStateUpdate> {
  // If the pending_write_action was nulled by a reject, just clear the gate
  if (!state.pending_write_action) {
    return {
      awaiting_approval: false,
      pending_write_action: null,
      run_status: "running",
      final_answer: "The action was cancelled by the user.",
    };
  }

  // Approved (or edited) — the payload is ready for downstream execution.
  // The actual Nango/Gmail/Outlook call happens in a separate execution
  // step AFTER this node, not inside it. We just clear the gate.
  return {
    awaiting_approval: false,
    run_status: "running",
  };
}
