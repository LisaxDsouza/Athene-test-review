import { requireAdmin, jsonError } from "@/lib/api/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { identity } = await requireAdmin(req);
    const body = await req.json();
    const provider = String(body.provider || "");
    const rawKey = String(body.key || "");
    const label = String(body.label || provider);
    if (!provider || !rawKey) return Response.json({ error: "provider and key are required" }, { status: 400 });
    const supabase = createSupabaseServiceClient();
    
    // Set the KMS secret in the DB session context
    await supabase.rpc("set_config_value", { 
        name: "app.kms_key", 
        value: requireEnv("ENCRYPTION_SECRET")
    });

    const { data: encryptedKey, error: encryptError } = await supabase.rpc("encrypt_llm_key", { 
        plaintext_key: rawKey 
    });

    if (encryptError) throw encryptError;

    const { data, error } = await supabase.from("llm_keys").upsert({
      org_id: identity.orgId,
      provider,
      label,
      key_encrypted: encryptedKey,
      key_hint: rawKey.slice(-4),
      custom_endpoint: body.custom_endpoint || null,
      is_active: true,
      created_by: identity.userId,
    }, { onConflict: "org_id,provider" }).select("id, provider, label, key_hint, is_active").single();
    if (error) throw error;
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
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
