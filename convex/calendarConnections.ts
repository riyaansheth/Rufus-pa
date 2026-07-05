import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireWorkspaceAccess } from "./lib/auth";
import { writeAuditLog } from "./lib/audit";
import { calendarProviderValidator } from "./schema";

/**
 * Calendar connection status — SAFE for the client. This query deliberately never
 * returns access/refresh tokens; only whether a provider is connected and the
 * associated account email.
 */
export const status = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    const connections = await ctx.db
      .query("calendarConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return connections.map((c) => ({
      provider: c.provider,
      status: c.status,
      accountEmail: c.accountEmail,
      lastError: c.lastError,
      connectedAt: c.createdAt,
    }));
  },
});

/**
 * INTERNAL — returns the full connection incl. tokens. Only callable from other
 * Convex functions (actions), never exposed to the client. Tokens stay server-side.
 * TODO(production): decrypt tokens here once encryption-at-rest is implemented.
 */
export const getConnectionInternal = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, userId }) => {
    // Prefer the acting user's own connection (each member connects their own
    // Google account); fall back to any workspace connection.
    if (userId) {
      const own = await ctx.db
        .query("calendarConnections")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", userId),
        )
        .first();
      if (own) return own;
    }
    return ctx.db
      .query("calendarConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
  },
});

/**
 * Store/refresh OAuth tokens for a workspace. Called from the OAuth callback route
 * (via an authenticated Convex client) and by token-refresh logic.
 *
 * TODO(production): encrypt accessToken/refreshToken before persisting. The columns
 * are isolated here specifically so encryption can be added in ONE place.
 */
export const upsertGoogleConnection = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    accountEmail: v.optional(v.string()),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireWorkspaceAccess(ctx, args.workspaceId);
    const now = Date.now();
    const existing = await ctx.db
      .query("calendarConnections")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", identity.clerkUserId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        provider: "google",
        accountEmail: args.accountEmail ?? existing.accountEmail,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken ?? existing.refreshToken,
        expiresAt: args.expiresAt,
        scope: args.scope,
        status: "connected",
        lastError: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("calendarConnections", {
        workspaceId: args.workspaceId,
        userId: identity.clerkUserId,
        provider: "google",
        accountEmail: args.accountEmail,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        scope: args.scope,
        status: "connected",
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeAuditLog(ctx, {
      workspaceId: args.workspaceId,
      actorUserId: identity.clerkUserId,
      action: "integration.connected",
      entityType: "calendarConnection",
      metadata: { provider: "google", accountEmail: args.accountEmail },
    });
  },
});

/** Update refreshed access token (called internally by the Google provider). */
export const updateAccessToken = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    accessToken: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, { workspaceId, accessToken, expiresAt }) => {
    const conn = await ctx.db
      .query("calendarConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    if (conn) {
      await ctx.db.patch(conn._id, {
        accessToken,
        expiresAt,
        status: "connected",
        updatedAt: Date.now(),
      });
    }
  },
});

/** Record an integration failure + audit log (called on Google API errors). */
export const recordFailure = internalMutation({
  args: { workspaceId: v.id("workspaces"), error: v.string() },
  handler: async (ctx, { workspaceId, error }) => {
    const conn = await ctx.db
      .query("calendarConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
    if (conn) {
      await ctx.db.patch(conn._id, {
        status: "error",
        lastError: error.slice(0, 500),
        updatedAt: Date.now(),
      });
      await writeAuditLog(ctx, {
        workspaceId,
        actorUserId: conn.userId,
        action: "integration.failed",
        entityType: "calendarConnection",
        metadata: { provider: conn.provider, error: error.slice(0, 500) },
      });
    }
  },
});

export const disconnect = mutation({
  args: { workspaceId: v.id("workspaces"), provider: calendarProviderValidator },
  handler: async (ctx, { workspaceId, provider }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const conns = await ctx.db
      .query("calendarConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    for (const c of conns) {
      if (c.provider === provider) {
        // Clear tokens on disconnect (do not retain secrets we no longer need).
        await ctx.db.patch(c._id, {
          status: "revoked",
          accessToken: undefined,
          refreshToken: undefined,
          updatedAt: Date.now(),
        });
      }
    }
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "integration.disconnected",
      entityType: "calendarConnection",
      metadata: { provider },
    });
  },
});
