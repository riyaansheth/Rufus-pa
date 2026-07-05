import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireWorkspaceAccess } from "./lib/auth";
import { writeAuditLog } from "./lib/audit";
import { monitorStatusValidator, monitorTypeValidator } from "./schema";

export async function insertMonitor(
  ctx: MutationCtx,
  actorUserId: string,
  args: {
    workspaceId: Id<"workspaces">;
    type: "product" | "movie_ticket" | "event" | "generic_url";
    title: string;
    url?: string;
    conditions?: unknown;
    checkFrequencyMinutes?: number;
    autoPrepareApproval?: boolean;
  },
): Promise<Id<"monitors">> {
  const title = args.title.trim();
  if (!title) throw new Error("Monitor title is required.");
  const now = Date.now();
  const id = await ctx.db.insert("monitors", {
    workspaceId: args.workspaceId,
    type: args.type,
    title,
    url: args.url?.trim() || undefined,
    conditions: args.conditions,
    status: "active",
    checkFrequencyMinutes: Math.max(5, args.checkFrequencyMinutes ?? 60),
    autoPrepareApproval: args.autoPrepareApproval ?? true,
    createdBy: actorUserId,
    createdAt: now,
    updatedAt: now,
  });
  await writeAuditLog(ctx, {
    workspaceId: args.workspaceId,
    actorUserId,
    action: "monitor.created",
    entityType: "monitor",
    entityId: id,
    metadata: { type: args.type, title, url: args.url },
  });
  return id;
}

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.optional(monitorStatusValidator),
  },
  handler: async (ctx, { workspaceId, status }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    const rows = status
      ? await ctx.db
          .query("monitors")
          .withIndex("by_workspace_status", (q) =>
            q.eq("workspaceId", workspaceId).eq("status", status),
          )
          .order("desc")
          .collect()
      : await ctx.db
          .query("monitors")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .order("desc")
          .collect();
    return rows;
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    type: monitorTypeValidator,
    title: v.string(),
    url: v.optional(v.string()),
    conditions: v.optional(v.any()),
    checkFrequencyMinutes: v.optional(v.number()),
    autoPrepareApproval: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireWorkspaceAccess(ctx, args.workspaceId);
    return insertMonitor(ctx, identity.clerkUserId, args);
  },
});

export const setStatus = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    monitorId: v.id("monitors"),
    status: monitorStatusValidator,
  },
  handler: async (ctx, { workspaceId, monitorId, status }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const monitor = await ctx.db.get(monitorId);
    if (!monitor || monitor.workspaceId !== workspaceId) {
      throw new Error("Monitor not found in this workspace.");
    }
    await ctx.db.patch(monitorId, { status, updatedAt: Date.now() });
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "monitor.updated",
      entityType: "monitor",
      entityId: monitorId,
      metadata: { status },
    });
  },
});

export const remove = mutation({
  args: { workspaceId: v.id("workspaces"), monitorId: v.id("monitors") },
  handler: async (ctx, { workspaceId, monitorId }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const monitor = await ctx.db.get(monitorId);
    if (!monitor || monitor.workspaceId !== workspaceId) {
      throw new Error("Monitor not found in this workspace.");
    }
    await ctx.db.delete(monitorId);
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "monitor.deleted",
      entityType: "monitor",
      entityId: monitorId,
    });
  },
});
