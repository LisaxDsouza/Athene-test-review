import { getRedis } from "@/lib/redis/client";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/auth/clerk";

export type UserAccess = {
  userId: string;
  orgId: string;
  role: UserRole;
  deptId: string;
  accessibleDeptIds: string[];
  biGrantId: string | null;
};

export async function resolveUserAccess(userId: string, orgId: string, fallbackRole?: UserRole): Promise<UserAccess> {
  const cacheKey = `user_access:${userId}:${orgId}`;
  const redis = getRedis();
  const cached = await redis.get<UserAccess>(cacheKey);
  if (cached) return cached;

  const supabase = createSupabaseServiceClient();
  const { data: member, error: memberError } = await supabase
    .from("org_members")
    .select("role, dept_id")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .single();

  if (memberError && memberError.code !== "PGRST116") throw memberError;
  
  let role = (member?.role || fallbackRole || "member") as UserRole;
  let ownDept = member?.dept_id || "";

  // ── AUTO-PROVISION USERS ──────────────────────────────────────────────────
  // If the user doesn't exist in the DB, sync them using Clerk's fallbackRole 
  // or default to "member". This prevents 403s and ensures accurate RBAC tracking.
  if (!member) {
      console.log(`[rbac] Auto-provisioning user: ${userId} in org ${orgId} with role ${role}`);
      const { data: newMember, error: insertError } = await supabase
          .from("org_members")
          .insert({
              user_id: userId,
              org_id: orgId,
              role: role
          })
          .select("role, dept_id")
          .single();
      
      if (!insertError && newMember) {
          role = newMember.role as UserRole;
          ownDept = newMember.dept_id || "";
      } else if (insertError) {
          console.error(`[rbac] Failed to auto-provision user ${userId}:`, insertError);
      }
  }

  let grantId: string | null = null;
  let grantedDeptIds: string[] = [];

  if (role === "bi_analyst") {
    const { data: grant, error: grantError } = await supabase
      .from("bi_access_grants")
      .select("id, granted_dept_ids")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .eq("is_active", true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (grantError) throw grantError;
    grantId = grant?.id || null;
    grantedDeptIds = (grant?.granted_dept_ids || []) as string[];
  }

  const access: UserAccess = {
    userId,
    orgId,
    role,
    deptId: ownDept,
    accessibleDeptIds: Array.from(new Set([ownDept, ...grantedDeptIds].filter(Boolean))),
    biGrantId: grantId,
  };
  await redis.set(cacheKey, access, { ex: 300 });
  return access;
}

export function assertAdmin(access: UserAccess) {
  if (access.role !== "admin") {
    const error = new Error("Admin role required");
    error.name = "ForbiddenError";
    throw error;
  }
}
