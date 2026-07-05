import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  ADMIN_ROLES,
  requireIdentity,
  requireWorkspaceAccess,
} from "./lib/auth";
import { notify, writeAuditLog } from "./lib/audit";
import { upsertUser } from "./users";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Unambiguous base32 alphabet (no 0/1/O/I) for human-shareable invite codes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
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
      if (ws) {
        // Do not expose inviteCode here — it's admin-only via `inviteCode` query.
        const { inviteCode: _omit, ...safe } = ws;
        result.push({ ...safe, role: m.role, membershipId: m._id });
      }
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
    const { inviteCode: _omit, ...safe } = ws;
    return { ...safe, role };
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
      inviteCode: generateInviteCode(),
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

/**
 * Join a workspace using a shared invite code. The caller joins as a "member".
 * This is what makes the multi-user roles (approver/admin) + approval flow usable:
 * an owner shares the code, teammates join, then owners/admins assign roles.
 */
export const join = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const identity = await requireIdentity(ctx);
    const normalized = code.trim().toUpperCase();
    if (!normalized) throw new Error("Enter an invite code.");
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", normalized))
      .unique();
    if (!workspace) throw new Error("Invalid invite code.");

    await upsertUser(ctx, {
      clerkUserId: identity.clerkUserId,
      email: identity.email,
      name: identity.name,
      imageUrl: identity.imageUrl,
    });

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspace._id).eq("userId", identity.clerkUserId),
      )
      .unique();
    if (existing) {
      return { workspaceId: workspace._id, alreadyMember: true };
    }

    const now = Date.now();
    await ctx.db.insert("memberships", {
      workspaceId: workspace._id,
      userId: identity.clerkUserId,
      role: "member",
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditLog(ctx, {
      workspaceId: workspace._id,
      actorUserId: identity.clerkUserId,
      action: "workspace.member_joined",
      entityType: "membership",
      metadata: { via: "invite_code" },
    });
    // Let owners/admins know someone joined.
    const members = await ctx.db
      .query("memberships")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    for (const m of members) {
      if (ADMIN_ROLES.includes(m.role)) {
        await notify(ctx, {
          workspaceId: workspace._id,
          userId: m.userId,
          title: "New member joined",
          message: identity.name ?? identity.email ?? "A teammate",
          type: "member_joined",
          href: "/settings",
        });
      }
    }
    return { workspaceId: workspace._id, alreadyMember: false };
  },
});

/** Return the workspace's invite code — owners/admins only. Generates one lazily. */
export const inviteCode = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceAccess(ctx, workspaceId, ADMIN_ROLES);
    const ws = await ctx.db.get(workspaceId);
    return ws?.inviteCode ?? null;
  },
});

/** Regenerate (or create) the invite code — owners/admins only. */
export const regenerateInviteCode = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { identity } = await requireWorkspaceAccess(
      ctx,
      workspaceId,
      ADMIN_ROLES,
    );
    const code = generateInviteCode();
    await ctx.db.patch(workspaceId, { inviteCode: code, updatedAt: Date.now() });
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "membership.role_changed",
      entityType: "workspace",
      entityId: workspaceId,
      metadata: { inviteCodeRotated: true },
    });
    return code;
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
