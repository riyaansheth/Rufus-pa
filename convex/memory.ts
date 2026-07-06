import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireIdentity } from "./lib/auth";

/**
 * Personal assistant memory: durable facts about the USER (not workspace data),
 * so the assistant remembers context across conversations and never re-asks
 * things like where they live. Keyed by Clerk user id — these follow the person
 * across workspaces. Reads/writes are always scoped to the caller's own id.
 */

const MAX_MEMORIES = 200;

/** The current user's remembered facts, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("userMemories")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(MAX_MEMORIES);
    return rows.map((r) => ({
      _id: r._id,
      content: r.content,
      createdAt: r.createdAt,
    }));
  },
});

/** Remember a new fact about the user. De-duplicates exact repeats. */
export const add = mutation({
  args: {
    content: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (ctx, { content, workspaceId }) => {
    const identity = await requireIdentity(ctx);
    const text = content.trim();
    if (!text) throw new Error("Nothing to remember.");
    // Skip if we already store an identical fact.
    const existing = await ctx.db
      .query("userMemories")
      .withIndex("by_user", (q) => q.eq("userId", identity.clerkUserId))
      .collect();
    const dup = existing.find(
      (m) => m.content.trim().toLowerCase() === text.toLowerCase(),
    );
    if (dup) return dup._id;
    return ctx.db.insert("userMemories", {
      userId: identity.clerkUserId,
      workspaceId,
      content: text,
      createdAt: Date.now(),
    });
  },
});

/** Forget a specific remembered fact (owner only). */
export const remove = mutation({
  args: { memoryId: v.id("userMemories") },
  handler: async (ctx, { memoryId }) => {
    const identity = await requireIdentity(ctx);
    const row = await ctx.db.get(memoryId);
    if (!row || row.userId !== identity.clerkUserId) {
      throw new Error("Memory not found.");
    }
    await ctx.db.delete(memoryId);
  },
});
