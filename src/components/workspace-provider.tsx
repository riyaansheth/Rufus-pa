"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export type Role = "owner" | "admin" | "member" | "approver";

export type WorkspaceSummary = {
  _id: Id<"workspaces">;
  name: string;
  slug: string;
  role: Role;
};

type WorkspaceContextValue = {
  workspaces: WorkspaceSummary[] | undefined;
  activeWorkspaceId: Id<"workspaces"> | null;
  activeWorkspace: WorkspaceSummary | null;
  role: Role | null;
  setActiveWorkspaceId: (id: Id<"workspaces">) => void;
  isLoading: boolean;
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

const STORAGE_KEY = "rufuspa.activeWorkspaceId";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const workspacesRaw = useQuery(api.workspaces.listMine);
  const workspaces = workspacesRaw as WorkspaceSummary[] | undefined;
  const [activeWorkspaceId, setActiveState] =
    React.useState<Id<"workspaces"> | null>(null);

  // Load persisted selection on mount.
  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setActiveState(stored as Id<"workspaces">);
  }, []);

  // Reconcile selection against the fetched list (pick first if none/invalid).
  React.useEffect(() => {
    if (!workspaces) return;
    const isValid =
      activeWorkspaceId && workspaces.some((w) => w._id === activeWorkspaceId);
    if (!isValid && workspaces.length > 0) {
      setActiveState(workspaces[0]._id);
      window.localStorage.setItem(STORAGE_KEY, workspaces[0]._id);
    }
  }, [workspaces, activeWorkspaceId]);

  const setActiveWorkspaceId = React.useCallback((id: Id<"workspaces">) => {
    setActiveState(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const activeWorkspace =
    workspaces?.find((w) => w._id === activeWorkspaceId) ?? null;

  const value: WorkspaceContextValue = {
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    role: activeWorkspace?.role ?? null,
    setActiveWorkspaceId,
    // Still "loading" while the list is in flight, OR while we have workspaces but
    // haven't reconciled the active one yet (prevents a "select a workspace" flash).
    isLoading:
      workspaces === undefined ||
      (workspaces.length > 0 && activeWorkspaceId === null),
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx)
    throw new Error("useWorkspace must be used within <WorkspaceProvider>");
  return ctx;
}
