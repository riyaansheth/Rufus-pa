"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ShieldCheck, ShieldAlert, Check, X, Loader2, Lock } from "lucide-react";
import { PageHeader, EmptyState, RequireWorkspace } from "@/components/page-shell";
import { useWorkspace } from "@/components/workspace-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatMoney } from "@/lib/utils";

const statusVariant: Record<string, "info" | "success" | "destructive" | "secondary"> = {
  pending: "info",
  approved: "success",
  rejected: "destructive",
  cancelled: "secondary",
};

export default function ApprovalsPage() {
  return (
    <RequireWorkspace>{(id) => <Approvals workspaceId={id} />}</RequireWorkspace>
  );
}

function Approvals({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const { role } = useWorkspace();
  const canApprove =
    role === "owner" || role === "admin" || role === "approver";
  const all = useQuery(api.approvals.list, { workspaceId });
  const decide = useMutation(api.approvals.decide);
  const cancel = useMutation(api.approvals.cancel);
  const me = useQuery(api.users.me);
  const { toast } = useToast();

  // The request currently being acted on — disables its buttons so a sensitive
  // decision can't be double-submitted (which would otherwise error/confuse).
  const [busyId, setBusyId] = React.useState<Id<"approvalRequests"> | null>(
    null,
  );

  const pending = all?.filter((a) => a.status === "pending") ?? [];
  const history = all?.filter((a) => a.status !== "pending") ?? [];

  async function onCancel(approvalId: Id<"approvalRequests">) {
    if (busyId) return;
    setBusyId(approvalId);
    try {
      await cancel({ workspaceId, approvalId });
      toast({ title: "Request cancelled" });
    } catch (err) {
      toast({
        title: "Could not cancel",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function onDecide(
    approvalId: Id<"approvalRequests">,
    decision: "approved" | "rejected",
  ) {
    if (busyId) return;
    setBusyId(approvalId);
    try {
      await decide({ workspaceId, approvalId, decision });
      toast({
        title: decision === "approved" ? "Approved" : "Rejected",
        variant: decision === "approved" ? "success" : "default",
      });
    } catch (err) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Sensitive and money-related actions require explicit human approval."
      />

      <Card className="mb-4 border-amber-300 bg-amber-50/60 dark:bg-amber-900/10">
        <CardContent className="flex items-start gap-3 pt-5 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p className="text-muted-foreground">
            The assistant never completes payments, OTPs, UPI, card entry, or
            checkout. It only prepares requests here. A human must complete the final
            payment/booking step on the provider&apos;s own site.
          </p>
        </CardContent>
      </Card>

      {all === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            Pending ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No pending approvals"
              description="Requests prepared by the assistant or team members appear here."
            />
          ) : (
            <div className="space-y-3">
              {pending.map((a) => (
                <Card key={a._id}>
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ShieldAlert className="size-4 text-amber-600" />
                        {a.title}
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {a.type.replace(/_/g, " ")} ·{" "}
                        {formatDateTime(a.createdAt)}
                      </p>
                    </div>
                    <Badge variant="info">pending</Badge>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {a.description ? (
                      <p className="text-sm text-muted-foreground">
                        {a.description}
                      </p>
                    ) : null}
                    {a.amount !== undefined ? (
                      <p className="text-sm font-medium">
                        Amount: {formatMoney(a.amount, a.currency ?? "INR")}
                      </p>
                    ) : null}
                    {a.payload &&
                    typeof a.payload === "object" &&
                    "url" in (a.payload as Record<string, unknown>) ? (
                      <a
                        href={String((a.payload as { url: string }).url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 underline"
                      >
                        Open linked page ↗
                      </a>
                    ) : null}
                    <div className="flex items-center gap-2 pt-1">
                      {canApprove ? (
                        <>
                          <Button
                            size="sm"
                            disabled={busyId === a._id}
                            onClick={() => onDecide(a._id, "approved")}
                          >
                            {busyId === a._id ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Check />
                            )}{" "}
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === a._id}
                            onClick={() => onDecide(a._id, "rejected")}
                          >
                            <X /> Reject
                          </Button>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          You do not have approver rights. Ask an owner, admin, or
                          approver to decide.
                        </p>
                      )}
                      {canApprove || a.requestedBy === me?.clerkUserId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto"
                          disabled={busyId === a._id}
                          onClick={() => onCancel(a._id)}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {history.length > 0 ? (
            <>
              <h2 className="mb-2 mt-8 text-sm font-medium text-muted-foreground">
                History
              </h2>
              <div className="space-y-2">
                {history.map((a) => (
                  <Card key={a._id}>
                    <CardContent className="flex items-center justify-between py-3.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.type.replace(/_/g, " ")} ·{" "}
                          {formatDateTime(a.updatedAt)}
                        </p>
                      </div>
                      <Badge variant={statusVariant[a.status] ?? "secondary"}>
                        {a.status}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
