"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ScrollText, Lock } from "lucide-react";
import { PageHeader, EmptyState, RequireWorkspace } from "@/components/page-shell";
import { useWorkspace } from "@/components/workspace-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/utils";

export default function AuditLogsPage() {
  return (
    <RequireWorkspace>{(id) => <AuditLogs workspaceId={id} />}</RequireWorkspace>
  );
}

function AuditLogs({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const { role } = useWorkspace();
  const isAdmin = role === "owner" || role === "admin";

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Audit Logs" />
        <EmptyState
          icon={Lock}
          title="Admins only"
          description="Audit logs are visible to owners and admins. Ask a workspace admin for access."
        />
      </div>
    );
  }

  return <AuditLogsTable workspaceId={workspaceId} />;
}

function AuditLogsTable({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const logs = useQuery(api.auditLogs.list, { workspaceId, limit: 200 });

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="A complete, append-only history of every action in this workspace."
      />

      {logs === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries yet" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Action</th>
                    <th className="px-4 py-2.5 font-medium">Entity</th>
                    <th className="px-4 py-2.5 font-medium">Actor</th>
                    <th className="px-4 py-2.5 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs.map((log) => (
                    <tr key={log._id}>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="font-mono text-xs">
                          {log.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {log.entityType ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {log.actor?.name || log.actor?.email || "system"}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {formatDateTime(log.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
