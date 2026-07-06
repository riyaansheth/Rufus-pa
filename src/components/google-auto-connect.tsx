"use client";

import * as React from "react";
import { useWorkspace } from "@/components/workspace-provider";

/**
 * If the user signed in with Google (with the calendar scope granted), silently
 * register their Google Calendar connection for the active workspace — no manual
 * "Connect" step. Server-side the route verifies the grant; this is just the
 * once-per-session trigger. Harmless no-op for email sign-ins.
 */
export function GoogleAutoConnect() {
  const { activeWorkspaceId } = useWorkspace();

  React.useEffect(() => {
    if (!activeWorkspaceId) return;
    const key = `rufuspa.gauto.${activeWorkspaceId}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
    void fetch("/api/integrations/google/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: activeWorkspaceId }),
    }).catch(() => {
      // Best-effort; the manual connect flow still exists in Settings.
    });
  }, [activeWorkspaceId]);

  return null;
}
