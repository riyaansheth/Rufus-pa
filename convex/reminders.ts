import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  MutationCtx,
} from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireWorkspaceAccess } from "./lib/auth";
import { writeAuditLog } from "./lib/audit";
import { scheduleGoogleSync } from "./lib/googleSync";
import { reminderStatusValidator } from "./schema";

// Reminders appear in Google Calendar as a 15-minute block at the remind time.
const REMINDER_EVENT_DURATION_MS = 15 * 60 * 1000;

export async function insertReminder(
  ctx: MutationCtx,
  actorUserId: string,
  args: {
    workspaceId: Id<"workspaces">;
    title: string;
    message?: string;
    remindAt: number;
  },
): Promise<Id<"reminders">> {
  const title = args.title.trim();
  if (!title) throw new Error("Reminder title is required.");
  if (!Number.isFinite(args.remindAt)) {
    throw new Error("Reminder needs a valid time.");
  }
  const now = Date.now();
  const reminderId = await ctx.db.insert("reminders", {
    workspaceId: args.workspaceId,
    title,
    message: args.message?.trim() || undefined,
    remindAt: args.remindAt,
    status: "scheduled",
    createdBy: actorUserId,
    createdAt: now,
    updatedAt: now,
  });
  await writeAuditLog(ctx, {
    workspaceId: args.workspaceId,
    actorUserId,
    action: "reminder.created",
    entityType: "reminder",
    entityId: reminderId,
    metadata: { title, remindAt: args.remindAt },
  });
  // Auto-fill Google Calendar with the reminder slot (when connected).
  await scheduleGoogleSync(ctx, {
    workspaceId: args.workspaceId,
    userId: actorUserId,
    op: "create",
    title: `Reminder: ${title}`,
    description: args.message,
    startAt: args.remindAt,
    endAt: args.remindAt + REMINDER_EVENT_DURATION_MS,
    writeBack: { table: "reminders", id: reminderId },
  });
  return reminderId;
}

/** INTERNAL — store the Google event id created by the sync action. */
export const setGoogleEventId = internalMutation({
  args: { reminderId: v.id("reminders"), googleEventId: v.string() },
  handler: async (ctx, { reminderId, googleEventId }) => {
    const reminder = await ctx.db.get(reminderId);
    if (reminder) await ctx.db.patch(reminderId, { googleEventId });
  },
});

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.optional(reminderStatusValidator),
  },
  handler: async (ctx, { workspaceId, status }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    const rows = status
      ? await ctx.db
          .query("reminders")
          .withIndex("by_workspace_status", (q) =>
            q.eq("workspaceId", workspaceId).eq("status", status),
          )
          .collect()
      : await ctx.db
          .query("reminders")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect();
    return rows.sort((a, b) => a.remindAt - b.remindAt);
  },
});

/** Upcoming, still-scheduled reminders (dashboard + assistant). */
export const listUpcoming = query({
  args: { workspaceId: v.id("workspaces"), limit: v.optional(v.number()) },
  handler: async (ctx, { workspaceId, limit }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    const rows = await ctx.db
      .query("reminders")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("status", "scheduled"),
      )
      .collect();
    return rows
      .sort((a, b) => a.remindAt - b.remindAt)
      .slice(0, limit ?? 10);
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    message: v.optional(v.string()),
    remindAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireWorkspaceAccess(ctx, args.workspaceId);
    return insertReminder(ctx, identity.clerkUserId, args);
  },
});

/** Move a scheduled reminder to a new time (used by the assistant + UI). */
export const reschedule = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    reminderId: v.id("reminders"),
    remindAt: v.number(),
  },
  handler: async (ctx, { workspaceId, reminderId, remindAt }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const reminder = await ctx.db.get(reminderId);
    if (!reminder || reminder.workspaceId !== workspaceId) {
      throw new Error("Reminder not found in this workspace.");
    }
    if (!Number.isFinite(remindAt)) {
      throw new Error("Reminder needs a valid time.");
    }
    await ctx.db.patch(reminderId, {
      remindAt,
      // Re-arm if it had already fired; a rescheduled reminder should fire again.
      status: "scheduled",
      updatedAt: Date.now(),
    });
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "reminder.updated",
      entityType: "reminder",
      entityId: reminderId,
      metadata: { rescheduledTo: remindAt },
    });
    // Move (or create) the mirrored Google Calendar slot.
    await scheduleGoogleSync(ctx, {
      workspaceId,
      userId: identity.clerkUserId,
      op: reminder.googleEventId ? "update" : "create",
      googleEventId: reminder.googleEventId,
      title: `Reminder: ${reminder.title}`,
      startAt: remindAt,
      endAt: remindAt + REMINDER_EVENT_DURATION_MS,
      writeBack: reminder.googleEventId
        ? undefined
        : { table: "reminders", id: reminderId },
    });
  },
});

export const cancel = mutation({
  args: { workspaceId: v.id("workspaces"), reminderId: v.id("reminders") },
  handler: async (ctx, { workspaceId, reminderId }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const reminder = await ctx.db.get(reminderId);
    if (!reminder || reminder.workspaceId !== workspaceId) {
      throw new Error("Reminder not found in this workspace.");
    }
    await ctx.db.patch(reminderId, {
      status: "cancelled",
      googleEventId: undefined,
      updatedAt: Date.now(),
    });
    if (reminder.googleEventId) {
      await scheduleGoogleSync(ctx, {
        workspaceId,
        userId: identity.clerkUserId,
        op: "delete",
        googleEventId: reminder.googleEventId,
      });
    }
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "reminder.updated",
      entityType: "reminder",
      entityId: reminderId,
      metadata: { status: "cancelled" },
    });
  },
});
