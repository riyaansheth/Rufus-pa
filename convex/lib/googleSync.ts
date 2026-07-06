import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Fire-and-forget Google Calendar sync from inside a mutation.
 *
 * Mutations must never make network calls, so we check for a live Google
 * connection (cheap DB read) and schedule the actual API work onto the
 * `googleCalendar.syncItem` internal action. If Google isn't connected this is a
 * no-op — the app works identically without it.
 */
export async function scheduleGoogleSync(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    userId?: string;
    op: "create" | "update" | "delete";
    googleEventId?: string;
    title?: string;
    description?: string;
    startAt?: number;
    endAt?: number;
    writeBack?: { table: "tasks" | "reminders"; id: string };
  },
): Promise<void> {
  // Prefer the acting user's own connection; fall back to any in the workspace.
  let conn = args.userId
    ? await ctx.db
        .query("calendarConnections")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("userId", args.userId!),
        )
        .first()
    : null;
  if (!conn) {
    conn = await ctx.db
      .query("calendarConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .first();
  }
  if (!conn || conn.provider !== "google" || conn.status !== "connected") {
    return;
  }
  await ctx.scheduler.runAfter(0, internal.googleCalendar.syncItem, args);
}
