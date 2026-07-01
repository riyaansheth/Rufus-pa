import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ADMIN_ROLES, requireWorkspaceAccess } from "./lib/auth";
import { roleValidator } from "./schema";
import { writeAuditLog } from "./lib/audit";

/** List members of a workspace (any member may view the roster). */
export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    const rows = [];
    for (const m of memberships) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_clerkUser", (q) => q.eq("clerkUserId", m.userId))
        .unique();
      rows.push({
        membershipId: m._id,
        userId: m.userId,
        role: m.role,
        name: user?.name,
        email: user?.email,
        imageUrl: user?.imageUrl,
        createdAt: m.createdAt,
      });
    }
    return rows;
  },
});

/** The current user's role in a workspace (used to gate UI + assistant tools). */
export const myRole = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { role } = await requireWorkspaceAccess(ctx, workspaceId);
    return role;
  },
});

/**
 * Change a member's role. Owner/admin only. Cannot demote the last owner
 * (prevents locking a workspace out of administration).
 */
export const changeRole = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    membershipId: v.id("memberships"),
    role: roleValidator,
  },
  handler: async (ctx, { workspaceId, membershipId, role }) => {
    const { identity } = await requireWorkspaceAccess(
      ctx,
      workspaceId,
      ADMIN_ROLES,
    );
    const target = await ctx.db.get(membershipId);
    if (!target || target.workspaceId !== workspaceId) {
      throw new Error("Membership not found in this workspace.");
    }
    if (target.role === "owner" && role !== "owner") {
      const owners = (
        await ctx.db
          .query("memberships")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect()
      ).filter((m) => m.role === "owner");
      if (owners.length <= 1) {
        throw new Error("Cannot demote the last owner of a workspace.");
      }
    }
    await ctx.db.patch(membershipId, { role, updatedAt: Date.now() });
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "membership.role_changed",
      entityType: "membership",
      entityId: membershipId,
      metadata: { targetUser: target.userId, newRole: role },
    });
  },
});
