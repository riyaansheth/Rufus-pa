import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireIdentity, requireWorkspaceAccess } from "./lib/auth";
import { writeAuditLog } from "./lib/audit";
import { upsertUser } from "./users";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** List every workspace the current user is a member of, with their role. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();

    const result = [];
    for (const m of memberships) {
      const ws = await ctx.db.get(m.workspaceId);
      if (ws) result.push({ ...ws, role: m.role, membershipId: m._id });
    }
    result.sort((a, b) => a.createdAt - b.createdAt);
    return result;
  },
});

/** Fetch a single workspace, enforcing membership. */
export const get = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { role } = await requireWorkspaceAccess(ctx, workspaceId);
    const ws = await ctx.db.get(workspaceId);
    if (!ws) return null;
    return { ...ws, role };
  },
});

/**
 * Create a workspace and make the creator its owner. This is the multi-tenant
 * entry point — one workspace == one client/company/team.
 */
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const identity = await requireIdentity(ctx);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      throw new Error("Workspace name must be at least 2 characters.");
    }
    await upsertUser(ctx, {
      clerkUserId: identity.clerkUserId,
      email: identity.email,
      name: identity.name,
      imageUrl: identity.imageUrl,
    });

    const now = Date.now();
    const slug = `${slugify(trimmed)}-${Math.abs(hashString(identity.clerkUserId + now)) % 10000}`;
    const workspaceId = await ctx.db.insert("workspaces", {
      name: trimmed,
      slug,
      createdBy: identity.clerkUserId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("memberships", {
      workspaceId,
      userId: identity.clerkUserId,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "workspace.created",
      entityType: "workspace",
      entityId: workspaceId,
      metadata: { name: trimmed },
    });
    return { workspaceId, slug };
  },
});

// Small deterministic hash for slug disambiguation (not security-sensitive).
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}
