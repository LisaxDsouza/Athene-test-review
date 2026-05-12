import { requireIdentity, jsonError } from "@/lib/api/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createInitialState, runAtheneGraph } from "@/lib/langgraph/graph";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { identity, access } = await requireIdentity(req);
    const { id } = await params;

    const supabase = createSupabaseServiceClient();

    // Load insight — verify org ownership
    const { data: insight, error } = await supabase
      .from("insights")
      .select("id, query, org_id, user_id")
      .eq("id", id)
      .eq("org_id", identity.orgId)
      .single();

    if (error || !insight) {
      return Response.json({ error: "Insight not found" }, { status: 404 });
    }

    // Users may only run their own insights unless they are admin
    if (insight.user_id !== identity.userId && identity.orgRole !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const state = createInitialState({
      prompt: insight.query,
      identity,
      access,
      mode: "analytical",
    });

    let finalAnswer: string | null = null;
    let citedSources: unknown[] = [];

    for await (const chunk of runAtheneGraph(state)) {
      if (chunk.final_answer) finalAnswer = chunk.final_answer;
      if (chunk.cited_sources?.length) citedSources = chunk.cited_sources;
    }

    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("insights")
      .update({
        result:       finalAnswer,
        citations:    citedSources,
        refreshed_at: now,
      })
      .eq("id", id);

    if (updateError) {
      console.error("[insights/run] Failed to save result:", updateError.message);
    }

    return Response.json({
      ok: true,
      result: finalAnswer,
      citations: citedSources,
      refreshed_at: now,
    });
  } catch (err) {
    return jsonError(err);
  }
}
