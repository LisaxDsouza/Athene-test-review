import { requireAdmin, jsonError } from "@/lib/api/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getRedis } from "@/lib/redis/client";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { identity } = await requireAdmin(req);
    const body = await req.json();
    const clerkUserId = String(body.user_id || "");
    const deptIds = Array.isArray(body.granted_dept_ids) ? body.granted_dept_ids : [];
    
    if (!clerkUserId || deptIds.length === 0) {
      return Response.json({ error: "user_id and granted_dept_ids are required" }, { status: 400 });
    }

    const supabase = createSupabaseServiceClient();

    // 1. Resolve Clerk user IDs to DB UUIDs
    const { data: member, error: memberError } = await supabase
      .from("org_members")
      .select("id")
      .eq("clerk_user_id", clerkUserId)
      .eq("org_id", identity.orgId)
      .single();

    const { data: adminMember, error: adminError } = await supabase
      .from("org_members")
      .select("id")
      .eq("clerk_user_id", identity.userId)
      .eq("org_id", identity.orgId)
      .single();

    if (memberError || adminError) throw memberError || adminError;

    // 2. Insert one row per department scope
    const rows = deptIds.map((deptId) => ({
      org_id: identity.orgId,
      user_id: member.id,
      scope_type: "department",
      scope_id: deptId,
      granted_by: adminMember.id,
      expires_at: body.expires_at || null,
      reason: body.reason || "BI Analyst access grant",
    }));

    const { error } = await supabase.from("access_grants").upsert(rows, {
      onConflict: "org_id,user_id,scope_type,scope_id",
    });

    if (error) throw error;

    await getRedis().del(`user_access:${clerkUserId}:${identity.orgId}`);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const { identity } = await requireAdmin(req);
    const grantId = new URL(req.url).searchParams.get("id");
    if (!grantId) return Response.json({ error: "id is required" }, { status: 400 });

    const supabase = createSupabaseServiceClient();

    // Find the clerk_user_id first to clear cache
    const { data: grant } = await supabase
      .from("access_grants")
      .select("user_id, org_members!inner(clerk_user_id)")
      .eq("id", grantId)
      .eq("org_id", identity.orgId)
      .single();

    const { error } = await supabase
      .from("access_grants")
      .delete()
      .eq("id", grantId)
      .eq("org_id", identity.orgId);

    if (error) throw error;

    const clerkUserId = (grant as any)?.org_members?.clerk_user_id;
    if (clerkUserId) {
      await getRedis().del(`user_access:${clerkUserId}:${identity.orgId}`);
    }

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
