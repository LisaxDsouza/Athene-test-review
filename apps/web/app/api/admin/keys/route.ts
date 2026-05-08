import { requireAdmin, jsonError } from "@/lib/api/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireEnv } from "@/lib/env";
import { invalidateByokCache } from "@/lib/langgraph/llm-factory";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { identity } = await requireAdmin(req);
    const { data, error } = await createSupabaseServiceClient()
      .from("org_api_keys")
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

    // Use encrypt_key(p_key, p_secret) — defined in migration 002_rls_policies.sql
    const { data: encryptedKey, error: encryptError } = await supabase.rpc("encrypt_key", { 
        p_key: rawKey,
        p_secret: secret
    });

    if (encryptError) throw encryptError;

    // Table: org_api_keys (migration 001_schema.sql)
    // Columns: encrypted_key, added_by (not key_encrypted, created_by)
    const { data, error } = await supabase.from("org_api_keys").upsert({
      org_id: identity.orgId,
      provider,
      label,
      encrypted_key: encryptedKey,
      key_hint: rawKey.slice(-4),
      custom_endpoint: body.custom_endpoint || null,
      is_active: true,
      added_by: identity.userId,
    }, { onConflict: "org_id,provider" }).select("id, provider, label, key_hint, is_active").single();
    if (error) throw error;

    // Invalidate the in-memory cache so agents pick up the new key immediately
    invalidateByokCache(identity.orgId);

    return Response.json(data);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const { identity } = await requireAdmin(req);
    const provider = new URL(req.url).searchParams.get("provider");
    if (!provider) return Response.json({ error: "provider is required" }, { status: 400 });
    const { error } = await createSupabaseServiceClient().from("org_api_keys").update({ is_active: false }).eq("org_id", identity.orgId).eq("provider", provider);
    if (error) throw error;

    // Invalidate the in-memory cache so agents stop using the deleted key immediately
    invalidateByokCache(identity.orgId);

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
