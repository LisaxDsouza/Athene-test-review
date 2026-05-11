import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { resolveUserAccess } from "@/lib/auth/rbac";
import { NextResponse } from "next/server";

// Define routes that should NOT be protected
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/onboarding(.*)",
  "/api/webhooks(.*)",  // Clerk/Svix — signature verified inside handler
  "/api/worker(.*)",   // QStash workers — signature verified inside handler
])

/**
 * Clerk Middleware (proxy.ts — Next.js 16 convention)
 * Handles authentication and resolves RBAC context to inject as headers.
 */
export default clerkMiddleware(async (auth, request) => {
  const { userId, orgId } = await auth();

  // 1. Enforce Authentication for non-public routes
  if (!isPublicRoute(request)) {
    if (!userId) {
      return (await auth()).redirectToSignIn();
    }
  }

  // 2. Resolve RBAC if we have a user and org context
  // Only inject headers if we are in an org context
  if (userId && orgId) {
    try {
      const { orgRole } = await auth();
      const access = await resolveUserAccess(userId, orgId, orgRole);

      const requestHeaders = new Headers(request.headers);

      // Inject RBAC context into headers for downstream API/Server Components
      requestHeaders.set("x-current-user-id", userId);
      requestHeaders.set("x-current-user-role", access.role || "member"); // Fallback to member

      if (access.dept_id) requestHeaders.set("x-current-user-dept-id", access.dept_id);
      if (access.accessible_dept_ids) {
        requestHeaders.set("x-current-accessible-depts", JSON.stringify(access.accessible_dept_ids));
      }
      if (access.bi_grant_id) requestHeaders.set("x-current-bi-grant-id", access.bi_grant_id);

      // Always inject the org and clerk user ID for verification
      requestHeaders.set("x-current-org-id", orgId);
      requestHeaders.set("x-clerk-user-id", userId);

      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    } catch (error) {
      console.error("Middleware RBAC resolution failed:", error);
      // Continue without RBAC headers; RLS will catch unauthorized access
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
