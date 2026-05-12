import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { resolveUserAccess, resolveOrgUuid } from "@/lib/auth/rbac";
import { getAgentGraph } from "@/lib/langgraph/graph";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get("threadId");

    if (!threadId) {
      return NextResponse.json(
        { error: "Missing threadId query parameter" },
        { status: 400 }
      );
    }

    // 1. Authenticate via Clerk
    const { userId: clerkUserId, orgId: clerkOrgId } = await auth();
    if (!clerkUserId || !clerkOrgId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. Resolve org UUID and user access (validates org membership)
    const [orgUuid, access] = await Promise.all([
      resolveOrgUuid(clerkOrgId),
      resolveUserAccess(clerkUserId, clerkOrgId),
    ]);
    if (!orgUuid || !access.role) {
      return NextResponse.json(
        { error: "User not found in organization" },
        { status: 403 }
      );
    }

    // 3. Retrieve Graph State
    const graph = await getAgentGraph();
    const currentState = await graph.getState({
      configurable: { thread_id: threadId },
    });

    if (!currentState || !currentState.values) {
      return NextResponse.json({
        status: "idle",
        next: [],
        values: null,
      });
    }

    interface StateValues {
      org_id?: string
      user_id?: string
      run_status?: string
      task_type?: string | null
      final_answer?: string | null
      awaiting_approval?: boolean
      pending_write_action?: Record<string, unknown> | null
      cited_sources?: unknown[]
    }
    const values = currentState.values as StateValues
    // Compare against resolved UUID (state stores Supabase UUID, not Clerk org ID)
    if (values.org_id !== orgUuid || values.user_id !== clerkUserId) {
      return NextResponse.json(
        { error: "Thread not found or access denied" },
        { status: 403 }
      );
    }

    let status = values.run_status ?? "idle"

    // Determine if the graph has completely finished
    // currentState.next is empty when graph reaches END
    if (status === "running" && (!currentState.next || currentState.next.length === 0)) {
      status = "completed";
    }

    // Prepare a safe payload for the frontend
    return NextResponse.json({
      status,
      next: currentState.next || [],
      values: {
        task_type: values.task_type || null,
        final_answer: values.final_answer || null,
        awaiting_approval: values.awaiting_approval || false,
        pending_write_action: values.pending_write_action || null,
        cited_sources: values.cited_sources || [],
      },
    });
  } catch (error: unknown) {
    console.error("[AgentStatus] Error fetching status:", error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
