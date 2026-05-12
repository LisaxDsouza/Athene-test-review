import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { resolveUserAccess, resolveOrgUuid } from "@/lib/auth/rbac";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getAgentGraph } from "@/lib/langgraph/graph";
import { HumanMessage } from "@langchain/core/messages";
import { mapRole } from "@/lib/auth/clerk";

export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) return new NextResponse("Unauthorized", { status: 401 });

  const [access, orgUuid] = await Promise.all([
    resolveUserAccess(userId, orgId, mapRole(orgRole ?? undefined) ?? "member"),
    resolveOrgUuid(orgId),
  ]);
  if (!orgUuid || !access.role) {
    return new NextResponse("Organization not found", { status: 403 });
  }

  const { id } = await params;

  const { data: insight, error } = await supabaseAdmin
    .from("insights")
    .select("id, query, org_id, user_id")
    .eq("id", id)
    .eq("org_id", orgUuid)
    .single();

  if (error || !insight) {
    return NextResponse.json({ error: "Insight not found" }, { status: 404 });
  }

  if (insight.user_id !== userId && access.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const graph = await getAgentGraph();
  const initialState = {
    messages: [new HumanMessage(insight.query)],
    org_id: orgUuid,
    user_id: userId,
    user_role: access.role,
    user_dept_id: access.dept_id ?? null,
    accessible_dept_ids: access.accessible_dept_ids ?? [],
    bi_grant_id: access.bi_grant_id ?? null,
  };

  let finalAnswer: string | null = null;
  let citedSources: unknown[] = [];

  const stream = await graph.stream(initialState, {
    configurable: { thread_id: `insight-${id}-${Date.now()}` },
    streamMode: "values",
  });

  for await (const chunk of stream as AsyncIterable<Record<string, unknown>>) {
    if (chunk.final_answer) finalAnswer = chunk.final_answer as string;
    if (Array.isArray(chunk.cited_sources) && chunk.cited_sources.length > 0) {
      citedSources = chunk.cited_sources;
    }
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from("insights")
    .update({ result: finalAnswer, citations: citedSources, refreshed_at: now })
    .eq("id", id);
  if (updateError) {
    console.error("[insights/run] Failed to persist result:", updateError.message);
  }

  return NextResponse.json({ ok: true, result: finalAnswer, citations: citedSources, refreshed_at: now });
}
