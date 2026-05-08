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
  const rawO = payload.o as Record<string, unknown> | string | undefined;
  let oId = "", oRole = "", oSlug = "";
  if (typeof rawO === "object" && rawO !== null) {
    oId = String(rawO.id || "");
    oRole = String(rawO.rol || "");
    oSlug = String(rawO.slg || "");
  } else if (typeof rawO === "string") {
    oId = rawO;
  }

  const orgId   = String(payload.org_id || payload.orgId || oId || "");
  const orgRole = String(payload.org_role || oRole || payload.role || "");
  const orgSlug = typeof payload.org_slug === "string" ? payload.org_slug : (oSlug || null);

  if (!userId) {
    console.error("[clerk-auth] Missing userId. Full payload:", JSON.stringify(payload));
    throw new Error("Clerk token is missing user claims");
  }

  if (!orgId) {
    console.warn("[clerk-auth] No orgId in token — user is not in an org. userId:", userId);
  }

  console.log(`[clerk-auth] Resolved: user=${userId} org=${orgId} role=${orgRole}`);

  return {
    userId,
    orgId:   orgId || "no-org",
    orgRole: normalizeRole(orgRole),
    orgSlug,
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