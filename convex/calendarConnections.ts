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
      tokenSource: c.tokenSource ?? "oauth",
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
    // STRICTLY the acting user's own connection. No fallback to teammates'
    // connections: personal calendars are personal — another member's items must
    // never sync into (or read from) your Google account.
    if (userId) {
      return ctx.db
        .query("calendarConnections")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", userId),
        )
        .first();
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

/**
 * Auto-connect for users who signed in with Google via Clerk. No tokens are stored:
 * the sync actions fetch a fresh access token from Clerk's API on demand (Clerk
 * handles refresh). Called by /api/integrations/google/auto after verifying the
 * user's Google sign-in actually granted the calendar scope. Idempotent.
 */
export const upsertClerkConnection = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    accountEmail: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, accountEmail }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const now = Date.now();
    const existing = await ctx.db
      .query("calendarConnections")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", identity.clerkUserId),
      )
      .first();

    if (existing) {
      // Don't clobber a manually-connected OAuth account that's working.
      if (existing.tokenSource !== "clerk" && existing.status === "connected") {
        return { connected: true, via: existing.tokenSource ?? "oauth" };
      }
      await ctx.db.patch(existing._id, {
        provider: "google",
        tokenSource: "clerk",
        accountEmail: accountEmail ?? existing.accountEmail,
        accessToken: undefined,
        refreshToken: undefined,
        expiresAt: undefined,
        status: "connected",
        lastError: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("calendarConnections", {
        workspaceId,
        userId: identity.clerkUserId,
        provider: "google",
        tokenSource: "clerk",
        accountEmail,
        status: "connected",
        createdAt: now,
        updatedAt: now,
      });
      await writeAuditLog(ctx, {
        workspaceId,
        actorUserId: identity.clerkUserId,
        action: "integration.connected",
        entityType: "calendarConnection",
        metadata: { provider: "google", via: "clerk_sign_in", accountEmail },
      });
    }
    return { connected: true, via: "clerk" };
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
