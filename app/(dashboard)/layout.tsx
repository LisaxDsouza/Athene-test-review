import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { resolveUserAccess } from "@/lib/auth/rbac";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, orgId, orgRole } = await auth();

  // Protect dashboard routes
  if (!userId) {
    redirect("/");
  }
  // Dashboard requires an active org — Clerk may return null orgId if the
  // user hasn't joined/selected one. Send them to sign-in to pick one.
  if (!orgId) {
    redirect("/onboarding");
  }

  const userAccess = await resolveUserAccess(userId, orgId, orgRole);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      {/* Sidebar */}
      <Sidebar role={userAccess.role ?? 'member'} className="hidden lg:flex" />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <Header role={userAccess.role ?? 'member'} />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-gradient-to-b from-[var(--background)] via-[var(--background)] to-purple-950/5 dark:to-purple-950/20">
          <div className="container mx-auto max-w-7xl px-8 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
