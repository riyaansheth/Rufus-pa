import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireWorkspaceAccess } from "./lib/auth";
import { writeAuditLog } from "./lib/audit";
import { priorityValidator, taskStatusValidator } from "./schema";

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
  return taskId;
}

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

/** Tasks due today (used by the dashboard + assistant `listTodaySchedule`). */
export const listDueToday = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const all = await ctx.db
      .query("tasks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return all.filter(
      (t) =>
        t.status !== "done" &&
        t.status !== "cancelled" &&
        t.dueAt !== undefined &&
        t.dueAt >= start.getTime() &&
        t.dueAt <= end.getTime(),
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
    if (args.dueAt !== undefined) patch.dueAt = args.dueAt ?? undefined;
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
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "task.deleted",
      entityType: "task",
      entityId: taskId,
    });
  },
});
