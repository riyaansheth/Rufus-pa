import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireIdentity } from "./lib/auth";
import { MutationCtx } from "./_generated/server";

/**
 * Ensure a `users` row exists for the given Clerk user, updating profile fields.
 * Used both by the Clerk webhook (authoritative) and lazily on first authenticated
 * call, so the app works even before webhooks are configured.
 */
export async function upsertUser(
  ctx: MutationCtx,
  data: {
    clerkUserId: string;
    email?: string;
    name?: string;
    imageUrl?: string;
  },
) {
  const now = Date.now();
  const existing = await ctx.db
    .query("users")
    .withIndex("by_clerkUser", (q) => q.eq("clerkUserId", data.clerkUserId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      email: data.email ?? existing.email,
      name: data.name ?? existing.name,
      imageUrl: data.imageUrl ?? existing.imageUrl,
      updatedAt: now,
    });
    return existing._id;
  }
  return ctx.db.insert("users", {
    clerkUserId: data.clerkUserId,
    email: data.email,
    name: data.name,
    imageUrl: data.imageUrl,
    createdAt: now,
    updatedAt: now,
  });
}

/** Return the current user's profile, creating/refreshing the row on the fly. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkUser", (q) => q.eq("clerkUserId", identity.subject))
      .unique();
    return {
      clerkUserId: identity.subject,
      email: identity.email ?? user?.email,
      name: identity.name ?? user?.name,
      imageUrl: identity.pictureUrl ?? user?.imageUrl,
    };
  },
});

/** Lazily sync the signed-in user into the `users` table. Idempotent. */
export const syncCurrentUser = mutation({
  args: { timezone: v.optional(v.string()) },
  handler: async (ctx, { timezone }) => {
    const identity = await requireIdentity(ctx);
    const userId = await upsertUser(ctx, {
      clerkUserId: identity.clerkUserId,
      email: identity.email,
      name: identity.name,
      imageUrl: identity.imageUrl,
    });
    // Keep the stored timezone fresh — the daily briefing fires at the user's
    // local hour, so this must track where they actually are.
    if (timezone) {
      await ctx.db.patch(userId, { timezone, updatedAt: Date.now() });
    }
    return userId;
  },
});

/** The current user's daily-briefing preferences (for the Settings page). */
export const briefingPrefs = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkUser", (q) => q.eq("clerkUserId", identity.subject))
      .unique();
    return {
      briefingEnabled: user?.briefingEnabled ?? false,
      briefingHour: user?.briefingHour ?? 8,
      timezone: user?.timezone ?? null,
    };
  },
});

/** Enable/disable the proactive morning briefing and pick the local hour. */
export const setBriefingPrefs = mutation({
  args: {
    briefingEnabled: v.boolean(),
    briefingHour: v.optional(v.number()),
  },
  handler: async (ctx, { briefingEnabled, briefingHour }) => {
    const identity = await requireIdentity(ctx);
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkUser", (q) =>
        q.eq("clerkUserId", identity.clerkUserId),
      )
      .unique();
    if (!user) throw new Error("User not found — reload and try again.");
    const hour = briefingHour ?? user.briefingHour ?? 8;
    if (hour < 0 || hour > 23) throw new Error("Hour must be 0-23.");
    await ctx.db.patch(user._id, {
      briefingEnabled,
      briefingHour: hour,
      updatedAt: Date.now(),
    });
  },
});

/** Called by the Clerk webhook (see convex/http.ts) — authoritative user sync. */
export const upsertFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => upsertUser(ctx, args),
});
