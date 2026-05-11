import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { Nango } from "@nangohq/node";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Supabase ────────────────────────────────────────────────────────────────

async function checkSupabase() {
  const tablesToCheck = [
    "organizations",
    "documents",
    "kg_nodes",
    "kg_edges",
    "nango_connections",
    "org_members",
  ];

  const results: Record<string, { ok: boolean; count?: number; error?: string }> = {};

  for (const table of tablesToCheck) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select("*", { count: "exact", head: true });

    if (error) {
      results[table] = {
        ok: false,
        error: error.message,
        code: (error as any).code,
        details: (error as any).details,
        hint: (error as any).hint,
      };
    } else {
      results[table] = { ok: true, count: count ?? 0 };
    }
  }

  const allOk = Object.values(results).every((r) => r.ok);
  return { ok: allOk, tables: results };
}

// ─── Knowledge Graph ─────────────────────────────────────────────────────────

async function checkKnowledgeGraph() {
  const [nodesResult, edgesResult, docsResult] = await Promise.all([
    supabaseAdmin.from("kg_nodes").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("kg_edges").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("documents").select("*", { count: "exact", head: true }),
  ]);

  if (nodesResult.error || edgesResult.error) {
    return {
      ok: false,
      error: nodesResult.error?.message ?? edgesResult.error?.message,
    };
  }

  const nodes = nodesResult.count ?? 0;
  const edges = edgesResult.count ?? 0;

  return {
    ok: true,
    nodes,
    edges,
    documents: docsResult.error ? "table missing" : (docsResult.count ?? 0),
    status: nodes > 0 ? "populated" : "empty — no graph built yet",
  };
}

// ─── Nango ───────────────────────────────────────────────────────────────────

async function checkNango() {
  const secretKey = process.env.NANGO_SECRET_KEY;
  if (!secretKey) {
    return { ok: false, error: "Missing NANGO_SECRET_KEY", connections: [] };
  }

  try {
    const nango = new Nango({ secretKey });
    const response = await nango.listConnections();
    // SDK v0.52 returns { connections: [...] } or an array directly
    const raw = (response as any)?.connections ?? response ?? [];
    const connections = Array.isArray(raw) ? raw : [];

    return {
      ok: true,
      connectionCount: connections.length,
      connections: connections.map((c: any) => ({
        provider: c.provider ?? c.provider_config_key,
        connectionId: c.connection_id,
        createdAt: c.created_at,
      })),
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message ?? String(err),
      connections: [],
    };
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET() {
  const [supabase, nango, knowledgeGraph] = await Promise.all([
    checkSupabase(),
    checkNango(),
    checkKnowledgeGraph(),
  ]);

  const overall = supabase.ok && nango.ok && knowledgeGraph.ok;

  return NextResponse.json(
    {
      overall: overall ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      services: { supabase, nango, knowledgeGraph },
    },
    { status: overall ? 200 : 207 }
  );
}
