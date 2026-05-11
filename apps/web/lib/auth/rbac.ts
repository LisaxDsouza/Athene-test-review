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
    .select("id, role, department_id")
    .eq("clerk_user_id", userId)
    .eq("org_id", orgId)
    .single();

  if (memberError && memberError.code !== "PGRST116") throw memberError;
  
  let role = (member?.role || fallbackRole || "member") as UserRole;
  let ownDept = member?.department_id || "";
  let memberDbId = member?.id;

  // ── AUTO-PROVISION USERS ──────────────────────────────────────────────────
  if (!member) {
      console.log(`[rbac] Auto-provisioning user: ${userId} in org ${orgId} with role ${role}`);
      const { data: newMember, error: insertError } = await supabase
          .from("org_members")
          .insert({
              clerk_user_id: userId,
              org_id: orgId,
              role: role
          })
          .select("id, role, department_id")
          .single();
      
      if (!insertError && newMember) {
          role = newMember.role as UserRole;
          ownDept = newMember.department_id || "";
          memberDbId = newMember.id;
      } else if (insertError) {
          console.error(`[rbac] Failed to auto-provision user ${userId}:`, insertError);
      }
  }

  let grantId: string | null = null;
  let grantedDeptIds: string[] = [];

  if ((role === "bi_analyst" || role === "super_user") && memberDbId) {
    const { data: grants, error: grantError } = await supabase
      .from("access_grants")
      .select("id, scope_id")
      .eq("user_id", memberDbId)
      .eq("org_id", orgId)
      .eq("scope_type", "department")
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

    if (grantError) throw grantError;
    
    if (grants && grants.length > 0) {
        grantId = grants[0].id; // For simplicity, take the first one as a reference
        grantedDeptIds = grants.map(g => g.scope_id);
    }
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
