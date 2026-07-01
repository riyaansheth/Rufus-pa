"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import type { Id } from "@convex/_generated/dataModel";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
      {Icon ? (
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
          <Icon className="size-6 text-muted-foreground" />
        </div>
      ) : null}
      <p className="font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Gate a page's content until an active workspace is available. Passes the resolved
 * workspaceId to the render function so pages never deal with a null id.
 */
export function RequireWorkspace({
  children,
}: {
  children: (workspaceId: Id<"workspaces">) => React.ReactNode;
}) {
  const { activeWorkspaceId, isLoading } = useWorkspace();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!activeWorkspaceId) {
    return (
      <p className="py-24 text-center text-sm text-muted-foreground">
        Select or create a workspace to continue.
      </p>
    );
  }
  return <>{children(activeWorkspaceId)}</>;
}
