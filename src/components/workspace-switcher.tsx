"use client";

import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { Select } from "@/components/ui/select";
import { useWorkspace } from "@/components/workspace-provider";
import type { Id } from "@convex/_generated/dataModel";

export function WorkspaceSwitcher() {
  const router = useRouter();
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId } =
    useWorkspace();

  if (!workspaces || workspaces.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <Building2 className="size-4 text-muted-foreground" />
      <Select
        className="w-48"
        value={activeWorkspaceId ?? ""}
        onChange={(e) => {
          if (e.target.value === "__new__") {
            router.push("/onboarding");
            return;
          }
          setActiveWorkspaceId(e.target.value as Id<"workspaces">);
        }}
      >
        {workspaces.map((w) => (
          <option key={w._id} value={w._id}>
            {w.name} · {w.role}
          </option>
        ))}
        <option value="__new__">+ New workspace…</option>
      </Select>
    </div>
  );
}

export function NewWorkspaceButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push("/onboarding")}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <Plus className="size-4" /> New workspace
    </button>
  );
}
