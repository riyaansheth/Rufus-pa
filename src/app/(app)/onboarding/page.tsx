"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { LogIn, Loader2 } from "lucide-react";
import { OnboardingCard } from "@/components/onboarding-card";
import { useWorkspace } from "@/components/workspace-provider";
import { PageHeader } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export default function OnboardingPage() {
  const { workspaces } = useWorkspace();
  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title="Workspaces"
        description="Create a new workspace, join one with an invite code, or switch between existing ones."
      />
      <OnboardingCard />
      <JoinWorkspaceCard />
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

function JoinWorkspaceCard() {
  const join = useMutation(api.workspaces.join);
  const { setActiveWorkspaceId } = useWorkspace();
  const { toast } = useToast();
  const [code, setCode] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setSubmitting(true);
    try {
      const res = await join({ code: code.trim() });
      setActiveWorkspaceId(res.workspaceId);
      toast({
        title: res.alreadyMember
          ? "You're already a member"
          : "Joined workspace",
        variant: "success",
      });
      setCode("");
    } catch (err) {
      toast({
        title: "Could not join",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LogIn className="size-4" /> Join with a code
        </CardTitle>
        <CardDescription>
          Have an invite code from a workspace owner? Enter it to join as a member.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <Input
            placeholder="e.g. ABCD2345"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="font-mono tracking-widest"
          />
          <Button type="submit" disabled={submitting || !code.trim()}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Join
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
