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
      // Personal profile (populated by the compulsory onboarding window).
      displayName: user?.displayName ?? null,
      city: user?.city ?? null,
      country: user?.country ?? null,
      jobTitle: user?.jobTitle ?? null,
      about: user?.about ?? null,
      timezone: user?.timezone ?? null,
      profileCompletedAt: user?.profileCompletedAt ?? null,
    };
  },
});

/**
 * Save the user's personal profile from the onboarding window (or Settings).
 * Requires a name and city; marks the profile complete so the app un-gates. The
 * assistant reads these fields so it never has to ask where the user lives, etc.
 */
export const updateProfile = mutation({
  args: {
    displayName: v.string(),
    city: v.string(),
    country: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    about: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    // Ensure a row exists (first-login may beat the webhook/lazy sync).
    const userId = await upsertUser(ctx, {
      clerkUserId: identity.clerkUserId,
      email: identity.email,
      name: identity.name,
      imageUrl: identity.imageUrl,
    });
    const displayName = args.displayName.trim();
    const city = args.city.trim();
    if (!displayName) throw new Error("Please enter your name.");
    if (!city) throw new Error("Please enter your city.");
    await ctx.db.patch(userId, {
      displayName,
      city,
      country: args.country?.trim() || undefined,
      jobTitle: args.jobTitle?.trim() || undefined,
      about: args.about?.trim() || undefined,
      timezone: args.timezone || undefined,
      profileCompletedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return userId;
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

/**
 * Partially update profile fields — used by the assistant when the user mentions
 * a change ("I moved to Delhi", "I'm a designer now"). Only patches provided
 * fields; never clears the profile-complete flag.
 */
export const patchProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    city: v.optional(v.string()),
    country: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    about: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const userId = await upsertUser(ctx, {
      clerkUserId: identity.clerkUserId,
      email: identity.email,
      name: identity.name,
      imageUrl: identity.imageUrl,
    });
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.displayName !== undefined) patch.displayName = args.displayName.trim();
    if (args.city !== undefined) patch.city = args.city.trim();
    if (args.country !== undefined) patch.country = args.country.trim() || undefined;
    if (args.jobTitle !== undefined) patch.jobTitle = args.jobTitle.trim() || undefined;
    if (args.about !== undefined) patch.about = args.about.trim() || undefined;
    await ctx.db.patch(userId, patch);
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
