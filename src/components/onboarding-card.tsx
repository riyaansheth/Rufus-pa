"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Building2, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useWorkspace } from "@/components/workspace-provider";

/**
 * Create-workspace form. A workspace represents one client, company, or team — the
 * top of the multi-tenant hierarchy. The creator becomes its owner.
 */
export function OnboardingCard() {
  const create = useMutation(api.workspaces.create);
  const { setActiveWorkspaceId } = useWorkspace();
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      toast({ title: "Name too short", variant: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const { workspaceId } = await create({ name: name.trim() });
      setActiveWorkspaceId(workspaceId);
      toast({ title: "Workspace created", variant: "success" });
      setName("");
    } catch (err) {
      toast({
        title: "Could not create workspace",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-primary/10">
          <Building2 className="size-5 text-primary" />
        </div>
        <CardTitle>Create your workspace</CardTitle>
        <CardDescription>
          One workspace = one client, company, or team. You can create more later
          and switch between them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input
              id="ws-name"
              placeholder="Acme Inc."
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Create workspace
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
