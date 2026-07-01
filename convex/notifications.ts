import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireWorkspaceAccess } from "./lib/auth";

/** The current user's notifications within a workspace, newest first. */
export const list = query({
  args: { workspaceId: v.id("workspaces"), limit: v.optional(v.number()) },
  handler: async (ctx, { workspaceId, limit }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", identity.clerkUserId),
      )
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit ?? 30);
  },
});

export const unreadCount = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", identity.subject),
      )
      .unique();
    if (!membership) return 0;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", identity.subject),
      )
      .collect();
    return rows.filter((n) => !n.read).length;
  },
});

export const markRead = mutation({
  args: { workspaceId: v.id("workspaces"), notificationId: v.id("notifications") },
  handler: async (ctx, { workspaceId, notificationId }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const n = await ctx.db.get(notificationId);
    if (!n || n.workspaceId !== workspaceId || n.userId !== identity.clerkUserId) {
      throw new Error("Notification not found.");
    }
    await ctx.db.patch(notificationId, { read: true });
  },
});

export const markAllRead = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", identity.clerkUserId),
      )
      .collect();
    for (const n of rows) {
      if (!n.read) await ctx.db.patch(n._id, { read: true });
    }
  },
});
