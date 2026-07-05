"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Settings2, Users, Plug, ShieldCheck, Copy, RefreshCw, UserPlus } from "lucide-react";
import { PageHeader, RequireWorkspace } from "@/components/page-shell";
import { useWorkspace } from "@/components/workspace-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

type Role = "owner" | "admin" | "member" | "approver";

export default function SettingsPage() {
  return (
    <RequireWorkspace>{(id) => <SettingsView workspaceId={id} />}</RequireWorkspace>
  );
}

function SettingsView({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const { activeWorkspace, role } = useWorkspace();
  const isAdmin = role === "owner" || role === "admin";
  const members = useQuery(api.memberships.list, { workspaceId });
  const changeRole = useMutation(api.memberships.changeRole);
  const inviteCode = useQuery(
    api.workspaces.inviteCode,
    isAdmin ? { workspaceId } : "skip",
  );
  const regenerateInvite = useMutation(api.workspaces.regenerateInviteCode);
  const { toast } = useToast();

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Settings"
        description={`Workspace: ${activeWorkspace?.name ?? ""}`}
      />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="size-4" /> Workspace
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Name:</span>{" "}
              {activeWorkspace?.name}
            </p>
            <p>
              <span className="text-muted-foreground">Your role:</span>{" "}
              <span className="capitalize">{role}</span>
            </p>
          </CardContent>
        </Card>

        {isAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserPlus className="size-4" /> Invite members
              </CardTitle>
              <CardDescription>
                Share this code. Teammates go to their workspace switcher → “New
                workspace” → “Join with a code” to join as a member. Owners/admins
                can then assign roles below.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border bg-muted px-3 py-2 font-mono text-lg tracking-widest">
                {inviteCode ?? "————————"}
              </code>
              <Button
                variant="outline"
                size="sm"
                disabled={!inviteCode}
                onClick={() => {
                  if (inviteCode) {
                    navigator.clipboard.writeText(inviteCode);
                    toast({ title: "Invite code copied", variant: "success" });
                  }
                }}
              >
                <Copy /> Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    await regenerateInvite({ workspaceId });
                    toast({ title: "New invite code generated" });
                  } catch (err) {
                    toast({
                      title: "Could not regenerate",
                      description:
                        err instanceof Error ? err.message : undefined,
                      variant: "error",
                    });
                  }
                }}
              >
                <RefreshCw /> Regenerate
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4" /> Members
              </CardTitle>
              <CardDescription>
                Roles: owner, admin, approver, member. Owners/admins manage roles;
                approvers can approve sensitive requests.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {members === undefined ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <ul className="divide-y">
                {members.map((m) => (
                  <li
                    key={m.membershipId}
                    className="flex items-center justify-between py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {m.name || m.email || m.userId.slice(0, 12)}
                      </p>
                      {m.email ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {m.email}
                        </p>
                      ) : null}
                    </div>
                    {isAdmin ? (
                      <Select
                        className="w-32"
                        value={m.role}
                        onChange={async (e) => {
                          try {
                            await changeRole({
                              workspaceId,
                              membershipId: m.membershipId,
                              role: e.target.value as Role,
                            });
                            toast({ title: "Role updated", variant: "success" });
                          } catch (err) {
                            toast({
                              title: "Could not update role",
                              description:
                                err instanceof Error ? err.message : undefined,
                              variant: "error",
                            });
                          }
                        }}
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="approver">Approver</option>
                        <option value="member">Member</option>
                      </Select>
                    ) : (
                      <Badge variant="secondary" className="capitalize">
                        {m.role}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Inviting new members is handled via Clerk organization/email sign-up in
              this MVP; new sign-ups can create or be added to workspaces.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plug className="size-4" /> Integrations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/settings/integrations">
              <Button variant="outline" size="sm">
                Manage integrations
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" /> Security
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>• The assistant never stores payment secrets, OTP, UPI PIN, or CVV.</p>
            <p>• Sensitive actions require explicit human approval.</p>
            <p>• OAuth tokens are stored server-side and never sent to the browser.</p>
            <p>• Every action is recorded in the audit log.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
