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
import { priorityValidator, taskStatusValidator } from "./schema";

// Tasks with a due date appear in Google Calendar as a 30-minute block.
const TASK_EVENT_DURATION_MS = 30 * 60 * 1000;

/**
 * Shared insert used by both the public `create` mutation and the assistant's
 * `createTask` tool, so validation + audit logging stay identical on both paths.
 */
export async function insertTask(
  ctx: MutationCtx,
  actorUserId: string,
  args: {
    workspaceId: Id<"workspaces">;
    title: string;
    description?: string;
    priority?: "low" | "medium" | "high";
    status?: "todo" | "in_progress" | "done" | "cancelled";
    dueAt?: number;
    assignedTo?: string;
  },
): Promise<Id<"tasks">> {
  const title = args.title.trim();
  if (!title) throw new Error("Task title is required.");
  const now = Date.now();
  const taskId = await ctx.db.insert("tasks", {
    workspaceId: args.workspaceId,
    title,
    description: args.description?.trim() || undefined,
    status: args.status ?? "todo",
    priority: args.priority ?? "medium",
    dueAt: args.dueAt,
    assignedTo: args.assignedTo,
    createdBy: actorUserId,
    createdAt: now,
    updatedAt: now,
  });
  await writeAuditLog(ctx, {
    workspaceId: args.workspaceId,
    actorUserId,
    action: "task.created",
    entityType: "task",
    entityId: taskId,
    metadata: { title },
  });
  // Auto-fill Google Calendar: tasks with a due date become a calendar block.
  if (args.dueAt) {
    await scheduleGoogleSync(ctx, {
      workspaceId: args.workspaceId,
      userId: actorUserId,
      op: "create",
      title: `Task: ${title}`,
      description: args.description,
      startAt: args.dueAt,
      endAt: args.dueAt + TASK_EVENT_DURATION_MS,
      writeBack: { table: "tasks", id: taskId },
    });
  }
  return taskId;
}

/** INTERNAL — store the Google event id created by the sync action. */
export const setGoogleEventId = internalMutation({
  args: { taskId: v.id("tasks"), googleEventId: v.string() },
  handler: async (ctx, { taskId, googleEventId }) => {
    const task = await ctx.db.get(taskId);
    if (task) await ctx.db.patch(taskId, { googleEventId });
  },
});

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.optional(taskStatusValidator),
  },
  handler: async (ctx, { workspaceId, status }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    if (status) {
      return ctx.db
        .query("tasks")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", workspaceId).eq("status", status),
        )
        .order("desc")
        .collect();
    }
    return ctx.db
      .query("tasks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .collect();
  },
});

/**
 * Tasks due today. "Today" is timezone-sensitive, so callers pass the day window
 * (dayStartMs/dayEndMs) computed in the USER's timezone. The dashboard derives these
 * from the browser's local clock; the assistant derives them from the user's tz.
 * Falls back to the server day (UTC) only if a window isn't supplied.
 */
export const listDueToday = query({
  args: {
    workspaceId: v.id("workspaces"),
    dayStartMs: v.optional(v.number()),
    dayEndMs: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, dayStartMs, dayEndMs }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    let start = dayStartMs;
    let end = dayEndMs;
    if (start === undefined || end === undefined) {
      const s = new Date();
      s.setHours(0, 0, 0, 0);
      const e = new Date();
      e.setHours(23, 59, 59, 999);
      start = s.getTime();
      end = e.getTime();
    }
    const all = await ctx.db
      .query("tasks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return all.filter(
      (t) =>
        t.status !== "done" &&
        t.status !== "cancelled" &&
        t.dueAt !== undefined &&
        t.dueAt >= start! &&
        t.dueAt <= end!,
    );
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(priorityValidator),
    dueAt: v.optional(v.number()),
    assignedTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireWorkspaceAccess(ctx, args.workspaceId);
    return insertTask(ctx, identity.clerkUserId, args);
  },
});

export const update = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(taskStatusValidator),
    priority: v.optional(priorityValidator),
    dueAt: v.optional(v.union(v.number(), v.null())),
    assignedTo: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.workspaceId !== args.workspaceId) {
      throw new Error("Task not found in this workspace.");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.description !== undefined) patch.description = args.description;
    if (args.status !== undefined) patch.status = args.status;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.dueAt !== undefined) {
      patch.dueAt = args.dueAt ?? undefined;
      // Re-arm the "due soon" alert for the new time.
      patch.dueNotifiedAt = undefined;
    }
    if (args.assignedTo !== undefined)
      patch.assignedTo = args.assignedTo ?? undefined;
    await ctx.db.patch(args.taskId, patch);
    await writeAuditLog(ctx, {
      workspaceId: args.workspaceId,
      actorUserId: identity.clerkUserId,
      action: "task.updated",
      entityType: "task",
      entityId: args.taskId,
      metadata: { changes: Object.keys(patch).filter((k) => k !== "updatedAt") },
    });

    // --- Keep the Google Calendar mirror in step with the task's state -------
    const after = await ctx.db.get(args.taskId);
    if (!after) return;
    const isActive = after.status === "todo" || after.status === "in_progress";
    const wantsEvent = isActive && after.dueAt !== undefined;
    if (wantsEvent && !after.googleEventId) {
      // Gained a due date (or was reopened) → create the calendar block.
      await scheduleGoogleSync(ctx, {
        workspaceId: args.workspaceId,
        userId: identity.clerkUserId,
        op: "create",
        title: `Task: ${after.title}`,
        description: after.description,
        startAt: after.dueAt!,
        endAt: after.dueAt! + TASK_EVENT_DURATION_MS,
        writeBack: { table: "tasks", id: args.taskId },
      });
    } else if (!wantsEvent && after.googleEventId) {
      // Completed/cancelled or due date removed → clear the calendar block.
      await ctx.db.patch(args.taskId, { googleEventId: undefined });
      await scheduleGoogleSync(ctx, {
        workspaceId: args.workspaceId,
        userId: identity.clerkUserId,
        op: "delete",
        googleEventId: after.googleEventId,
      });
    } else if (
      wantsEvent &&
      after.googleEventId &&
      (args.title !== undefined || args.dueAt !== undefined)
    ) {
      await scheduleGoogleSync(ctx, {
        workspaceId: args.workspaceId,
        userId: identity.clerkUserId,
        op: "update",
        googleEventId: after.googleEventId,
        title: `Task: ${after.title}`,
        startAt: after.dueAt!,
        endAt: after.dueAt! + TASK_EVENT_DURATION_MS,
      });
    }
  },
});

export const remove = mutation({
  args: { workspaceId: v.id("workspaces"), taskId: v.id("tasks") },
  handler: async (ctx, { workspaceId, taskId }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const task = await ctx.db.get(taskId);
    if (!task || task.workspaceId !== workspaceId) {
      throw new Error("Task not found in this workspace.");
    }
    await ctx.db.delete(taskId);
    if (task.googleEventId) {
      await scheduleGoogleSync(ctx, {
        workspaceId,
        userId: identity.clerkUserId,
        op: "delete",
        googleEventId: task.googleEventId,
      });
    }
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "task.deleted",
      entityType: "task",
      entityId: taskId,
    });
  },
});
