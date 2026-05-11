import { requireAdmin, jsonError } from "@/lib/api/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { identity } = await requireAdmin(req);
    const { data, error } = await createSupabaseServiceClient()
      .from("llm_keys")
      .select("id, provider, label, key_hint, is_active, created_at")
      .eq("org_id", identity.orgId)
      .eq("is_active", true);
    if (error) throw error;
    return Response.json(data);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    const { identity } = await requireAdmin(req);
    const body = await req.json();
    const provider = String(body.provider || "");
    const rawKey = String(body.key || "");
    const label = String(body.label || provider);
    if (!provider || !rawKey) return Response.json({ error: "provider and key are required" }, { status: 400 });
    const supabase = createSupabaseServiceClient();
    
    const secret = process.env.ENCRYPTION_SECRET || process.env.KMS_SECRET;
    if (!secret) {
        return Response.json({ error: "Missing required environment variable for encryption" }, { status: 500 });
    }

    // Use store_llm_key RPC — defined in migration 008_rls_helpers.sql
    const { error: storeError } = await supabase.rpc("store_llm_key", { 
        p_org_id: identity.orgId,
        p_provider: provider,
        p_plaintext: rawKey,
        p_kms_key: secret
    });

    if (storeError) throw storeError;

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const { identity } = await requireAdmin(req);
    const provider = new URL(req.url).searchParams.get("provider");
    if (!provider) return Response.json({ error: "provider is required" }, { status: 400 });
    const { error } = await createSupabaseServiceClient().from("llm_keys").update({ is_active: false }).eq("org_id", identity.orgId).eq("provider", provider);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
