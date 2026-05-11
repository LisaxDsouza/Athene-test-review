// ============================================================
// POST /api/threads/[id]/approve — HITL approval endpoint (ATH-43)
//
// Accepts: { action: 'approve'|'edit'|'reject', edits?: object }
//
// Flow:
//   1. Authenticate via Clerk
//   2. Verify the caller owns the thread
//   3. Validate the request body
//   4. Log the decision to hitl_decisions
//   5. Update the graph checkpoint state with the decision
//   6. Resume the graph so approval_node executes
//
// Rule #4: No writes without explicit human approval.
// ============================================================

import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { resolveUserAccess } from "@/lib/auth/rbac";
import {
  processDecision,
  logHitlDecision,
  type HitlRequest,
} from "@/lib/graph/interrupts";
import { getAgentGraph } from "@/lib/langgraph/graph";

// ---- Route handler -------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Authenticate
  const { userId: clerkUserId, orgId: clerkOrgId } = await auth();

  if (!clerkUserId || !clerkOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Resolve user access and verify org membership
  const access = await resolveUserAccess(clerkUserId, clerkOrgId);
  if (!access.role) {
    return NextResponse.json(
      { error: "User not found in organization" },
      { status: 403 },
    );
  }

  const { id: threadId } = await params;

  // 3. Parse and validate request body
  let body: HitlRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!["approve", "edit", "reject"].includes(body.action)) {
    return NextResponse.json(
      { error: "action must be 'approve', 'edit', or 'reject'" },
      { status: 400 },
    );
  }

  if (body.action === "edit" && (!body.edits || Object.keys(body.edits).length === 0)) {
    return NextResponse.json(
      { error: "Edit action requires a non-empty edits object" },
      { status: 400 },
    );
  }

  // 4. Get the current graph state and verify thread ownership.
  // We authorize from the checkpoint state because the thread routes are keyed by
  // LangGraph thread_id; a separate threads table row is not guaranteed to exist.
  const graph = await getAgentGraph();

  const currentState = await graph.getState({
    configurable: { thread_id: threadId },
  });

  if (!currentState?.values) {
    return NextResponse.json(
      { error: "No graph state found for this thread" },
      { status: 404 },
    );
  }

  const stateValues = currentState.values as Record<string, unknown>;
  if (stateValues.org_id !== clerkOrgId || stateValues.user_id !== clerkUserId) {
    return NextResponse.json(
      { error: "Thread not found or you are not the owner" },
      { status: 403 },
    );
  }

  const pendingAction = stateValues.pending_write_action as {
    tool: string;
    payload: Record<string, unknown>;
    requested_at: string;
  } | null;

  if (!pendingAction) {
    return NextResponse.json(
      { error: "No pending action to approve" },
      { status: 409 },
    );
  }

  // 5. Process the decision
  let result;
  try {
    result = processDecision(body, pendingAction as any);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 400 },
    );
  }

  // 6. Audit log the decision
  await logHitlDecision({
    orgId: clerkOrgId,
    threadId,
    userId: clerkUserId,
    actionType: pendingAction.tool,
    decision: body.action,
    originalPayload: pendingAction.payload,
    editedPayload: body.action === "edit" ? (result.payload as Record<string, unknown>) : null,
  });

  // 7. Update state and resume the graph
  const stateUpdate = result.approved
    ? {
        // Keep pending_write_action with final payload for downstream execution
        pending_write_action: {
          tool: pendingAction.tool,
          payload: result.payload,
          requested_at: pendingAction.requested_at,
        },
      }
    : {
        // Rejected — clear the pending action
        pending_write_action: null,
      };

  await graph.updateState(
    { configurable: { thread_id: threadId } },
    stateUpdate,
  );

  // 8. Resume the graph.
  // The graph will now execute approval_node → synthesis_agent → END
  // We don't await the full stream here — the client polls /api/agent/status
  const resumeConfig = { configurable: { thread_id: threadId } };

  // Fire-and-forget: stream the rest of the graph.
  // Client polls /api/agent/status for completion — we intentionally don't block here.
  (async () => {
    try {
      const stream = await graph.stream(null, resumeConfig);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of stream) { /* drives execution */ }
    } catch (err) {
      console.error("[hitl] Graph resume failed after approval", {
        threadId,
        orgId: clerkOrgId,
        userId: clerkUserId,
        decision: body.action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return NextResponse.json({
    success: true,
    decision: body.action,
    approved: result.approved,
  });
}
