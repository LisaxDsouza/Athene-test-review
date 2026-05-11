import { requireAdmin, jsonError } from "@/lib/api/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { identity } = await requireAdmin(req);
    const url = new URL(req.url);
    let query = createSupabaseServiceClient()
      .from("security_audit_log")
      .select("id, user_id, role, grant_count, created_at")
      .eq("org_id", identity.orgId)
      .order("created_at", { ascending: false })
      .limit(Number(url.searchParams.get("limit") || 100));
    const userId = url.searchParams.get("user_id");
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query;
    if (error) throw error;
    return Response.json(data);
  } catch (error) {
    return jsonError(error);
  }
}
