import { v } from "convex/values";
import { query } from "./_generated/server";
import { ADMIN_ROLES, requireWorkspaceAccess } from "./lib/auth";

/**
 * Audit log feed. Owner/admin only — this is a security-sensitive view of every
 * action taken in the workspace.
 */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, limit }) => {
    await requireWorkspaceAccess(ctx, workspaceId, ADMIN_ROLES);
    const rows = await ctx.db
      .query("auditLogs")
      .withIndex("by_workspace_createdAt", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .order("desc")
      .take(limit ?? 100);

    // Attach actor display info.
    const cache = new Map<string, { name?: string; email?: string }>();
    const enriched = [];
    for (const row of rows) {
      if (!cache.has(row.actorUserId)) {
        const user = await ctx.db
          .query("users")
          .withIndex("by_clerkUser", (q) =>
            q.eq("clerkUserId", row.actorUserId),
          )
          .unique();
        cache.set(row.actorUserId, {
          name: user?.name,
          email: user?.email,
        });
      }
      enriched.push({ ...row, actor: cache.get(row.actorUserId) });
    }
    return enriched;
  },
});

/** Recent actions for the dashboard (any member may see high-level activity). */
export const recent = query({
  args: { workspaceId: v.id("workspaces"), limit: v.optional(v.number()) },
  handler: async (ctx, { workspaceId, limit }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    return ctx.db
      .query("auditLogs")
      .withIndex("by_workspace_createdAt", (q) =>
        q.eq("workspaceId", workspaceId),
      )
      .order("desc")
      .take(limit ?? 15);
  },
});
