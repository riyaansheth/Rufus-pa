"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { NotificationBell } from "@/components/notification-bell";
import { QuickCapture } from "@/components/quick-capture";
import { GoogleAutoConnect } from "@/components/google-auto-connect";
import { UserSync } from "@/components/user-sync";
import { OnboardingCard } from "@/components/onboarding-card";
import { ProfileSetup } from "@/components/profile-setup";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <UserSync />
      <WorkspaceProvider>
        <GoogleAutoConnect />
        <Shell>{children}</Shell>
      </WorkspaceProvider>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const { workspaces, isLoading: wsLoading } = useWorkspace();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");

  // Wait for auth, the workspace list, and the user profile before deciding.
  if (authLoading || (isAuthenticated && (wsLoading || me === undefined))) {
    return <FullScreenLoader />;
  }

  // COMPULSORY profile step: every user completes their profile (name, city, …)
  // before the app is shown, so the assistant already knows who they are.
  if (isAuthenticated && me && !me.profileCompletedAt) {
    return <ProfileSetup me={me} />;
  }

  // Signed in but no workspace yet → onboarding.
  const needsOnboarding = isAuthenticated && workspaces && workspaces.length === 0;

  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b bg-card/40 px-4 md:px-6">
          <WorkspaceSwitcher />
          <div className="flex items-center gap-2">
            <QuickCapture />
            <NotificationBell />
            <UserButton afterSignOutUrl="/" />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {needsOnboarding ? (
            <div className="mx-auto max-w-md py-16">
              <OnboardingCard />
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
