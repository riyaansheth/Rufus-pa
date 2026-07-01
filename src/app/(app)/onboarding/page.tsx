"use client";

import { OnboardingCard } from "@/components/onboarding-card";
import { useWorkspace } from "@/components/workspace-provider";
import { PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";

export default function OnboardingPage() {
  const { workspaces } = useWorkspace();
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Workspaces" description="Create a new workspace or switch between existing ones." />
      <OnboardingCard />
      {workspaces && workspaces.length > 0 ? (
        <Card className="mt-4">
          <CardContent className="pt-5">
            <p className="mb-2 text-sm font-medium">Your workspaces</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {workspaces.map((w) => (
                <li key={w._id} className="flex justify-between">
                  <span>{w.name}</span>
                  <span className="capitalize">{w.role}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
