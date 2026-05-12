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
import { resolveUserAccess, resolveOrgUuid } from "@/lib/auth/rbac";
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

  // 2. Resolve org UUID + user access — org_id in graph state is a Supabase UUID,
  //    not the Clerk org string. We must compare like-for-like.
  const [orgUuid, access] = await Promise.all([
    resolveOrgUuid(clerkOrgId),
    resolveUserAccess(clerkUserId, clerkOrgId),
  ]);
  if (!orgUuid || !access.role) {
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
  // Compare against Supabase UUID (state.org_id) not the Clerk org string
  if (stateValues.org_id !== orgUuid || stateValues.user_id !== clerkUserId) {
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
  // The graph will now execute approval_node → synthesis_agent → END.
  // Race the stream against a 25-second timeout:
  //   • Completes within timeout → 200 { status: 'resumed' }
  //   • Times out              → 202 { status: 'processing' } (graph still runs; client polls)
  //   • Throws                 → 500 with the error
  const resumeConfig = { configurable: { thread_id: threadId } };

  const TIMEOUT_MS = 25_000;

  const runStream = async (): Promise<void> => {
    const stream = await graph.stream(null, resumeConfig);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of stream) { /* drives execution */ }
  };

  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), TIMEOUT_MS)
  );

  let raceResult: void | 'timeout';
  try {
    raceResult = await Promise.race([runStream(), timeout]);
  } catch (err) {
    console.error("[hitl] Graph resume failed after approval", {
      threadId,
      orgId: clerkOrgId,
      userId: clerkUserId,
      decision: body.action,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Graph resume failed" },
      { status: 500 }
    );
  }

  if (raceResult === 'timeout') {
    // Graph is still running in the background — client should poll /api/agent/status
    return NextResponse.json({
      status: 'processing',
      decision: body.action,
      approved: result.approved,
    }, { status: 202 });
  }

  return NextResponse.json({
    status: 'resumed',
    decision: body.action,
    approved: result.approved,
  });
}
