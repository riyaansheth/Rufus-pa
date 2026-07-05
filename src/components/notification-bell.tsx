"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useWorkspace } from "@/components/workspace-provider";
import { cn, formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function NotificationBell() {
  const { activeWorkspaceId } = useWorkspace();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const unread = useQuery(
    api.notifications.unreadCount,
    activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
  );
  const notifications = useQuery(
    api.notifications.list,
    activeWorkspaceId ? { workspaceId: activeWorkspaceId, limit: 20 } : "skip",
  );
  const markAllRead = useMutation(api.notifications.markAllRead);
  const markRead = useMutation(api.notifications.markRead);

  function onNotificationClick(n: {
    _id: Id<"notifications">;
    read: boolean;
    href?: string;
  }) {
    if (activeWorkspaceId && !n.read) {
      void markRead({ workspaceId: activeWorkspaceId, notificationId: n._id });
    }
    setOpen(false);
    if (n.href) router.push(n.href);
  }

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const count = unread ?? 0;

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
      >
        <Bell className="size-5" />
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-medium">Notifications</span>
            {activeWorkspaceId && count > 0 ? (
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  markAllRead({ workspaceId: activeWorkspaceId })
                }
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!notifications || notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No notifications yet.
              </p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n._id}
                  onClick={() => onNotificationClick(n)}
                  className={cn(
                    "block w-full border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent",
                    !n.read && "bg-accent/40",
                  )}
                >
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.message ? (
                    <p className="text-sm text-muted-foreground">{n.message}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatRelative(n.createdAt)}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
