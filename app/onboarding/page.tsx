"use client";

import { CreateOrganization, useOrganization } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function OnboardingPage() {
  const { organization } = useOrganization();
  const router = useRouter();

  // Once the user creates / joins an org, send them into the app
  useEffect(() => {
    if (organization) router.push("/chat");
  }, [organization, router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 bg-[var(--background)]">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-violet-400 bg-clip-text text-transparent">
          Create your workspace
        </h1>
        <p className="text-[var(--sidebar-text-secondary)]">
          Set up your organization to get started with Athene AI.
        </p>
      </div>
      <CreateOrganization afterCreateOrganizationUrl="/chat" skipInvitationScreen />
    </div>
  );
}
