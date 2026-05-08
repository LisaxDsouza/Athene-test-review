import { verifyToken } from "@clerk/nextjs/server";

export type UserRole = "admin" | "member" | "bi_analyst";

export type AtheneIdentity = {
  userId: string;
  orgId: string;
  orgRole: UserRole;
  orgSlug: string | null;
  email: string | null;
  exp: number;
};

function normalizeRole(role: unknown): UserRole {
  if (role === "org:admin" || role === "admin") return "admin";
  if (role === "org:bi_analyst" || role === "bi_analyst") return "bi_analyst";
  return "member";
}

export function extractOrgClaims(payload: Record<string, unknown>): AtheneIdentity {
  const userId = String(payload.sub || "");
  const orgId = String(payload.org_id || payload.orgId || payload.o || "");
  const orgRole = String(payload.org_role || payload.role || "");
  
  if (!userId || !orgId) {
    console.error("[clerk-auth] Missing claims:", { userId, orgId, keys: Object.keys(payload) });
    throw new Error("Clerk token is missing user or organization claims");
  }
  
  console.log(`[clerk-auth] Resolved: user=${userId} org=${orgId} role=${orgRole} keys=${Object.keys(payload).join(',')}`);
  
  return {
    userId,
    orgId,
    orgRole: normalizeRole(orgRole),
    orgSlug: typeof payload.org_slug === "string" ? payload.org_slug : null,
    email: typeof payload.email === "string" ? payload.email : null,
    exp: Number(payload.exp || 0),
  };
}

export async function verifyClerkJWT(authHeader: string | null): Promise<AtheneIdentity> {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing bearer token");
  const token = authHeader.slice("Bearer ".length);
  const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
  return extractOrgClaims(payload as Record<string, unknown>);
}
