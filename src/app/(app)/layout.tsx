"use client";

import { useConvexAuth } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { NotificationBell } from "@/components/notification-bell";
import { QuickCapture } from "@/components/quick-capture";
import { UserSync } from "@/components/user-sync";
import { OnboardingCard } from "@/components/onboarding-card";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <UserSync />
      <WorkspaceProvider>
        <Shell>{children}</Shell>
      </WorkspaceProvider>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const { workspaces, isLoading: wsLoading } = useWorkspace();

  if (authLoading || (isAuthenticated && wsLoading)) {
    return <FullScreenLoader />;
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
