import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireWorkspaceAccess } from "./lib/auth";

/**
 * Persistence for assistant conversations + messages. The heavy lifting (OpenAI
 * tool-calling) lives in convex/assistant.ts; this file is just typed storage.
 */

const actionValidator = v.array(
  v.object({
    kind: v.string(),
    label: v.string(),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    href: v.optional(v.string()),
  }),
);

export const createConversation = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    title: v.string(),
  },
  handler: async (ctx, { workspaceId, userId, title }) => {
    const now = Date.now();
    return ctx.db.insert("assistantConversations", {
      workspaceId,
      userId,
      title: title.slice(0, 80) || "New conversation",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const addMessage = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("assistantConversations"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("tool"),
      v.literal("system"),
    ),
    content: v.string(),
    actions: v.optional(actionValidator),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("assistantMessages", {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      actions: args.actions,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.conversationId, { updatedAt: Date.now() });
    return id;
  },
});

/**
 * INTERNAL — assert a conversation belongs to this workspace AND this user.
 * Guards the assistant action against cross-tenant / cross-user conversation access
 * (a passed conversationId is otherwise attacker-controlled).
 */
export const assertConversationOwnership = internalQuery({
  args: {
    conversationId: v.id("assistantConversations"),
    workspaceId: v.id("workspaces"),
    userId: v.string(),
  },
  handler: async (ctx, { conversationId, workspaceId, userId }) => {
    const c = await ctx.db.get(conversationId);
    if (!c || c.workspaceId !== workspaceId || c.userId !== userId) {
      throw new Error("Conversation not found in this workspace.");
    }
    return true;
  },
});

/**
 * INTERNAL — message history for building the model context.
 *
 * Capped to the most recent messages so we never resend an unbounded conversation
 * to OpenAI (token cost grows with length and eventually exceeds the context window).
 */
const MODEL_HISTORY_LIMIT = 20;

export const historyForModel = internalQuery({
  args: { conversationId: v.id("assistantConversations") },
  handler: async (ctx, { conversationId }) => {
    // Take newest N (bounded read), then restore chronological order.
    const recent = await ctx.db
      .query("assistantMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .order("desc")
      .take(MODEL_HISTORY_LIMIT);
    return recent.reverse().map((m) => ({ role: m.role, content: m.content }));
  },
});

// --- Client-facing queries -------------------------------------------------

export const listConversations = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const rows = await ctx.db
      .query("assistantConversations")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", identity.clerkUserId),
      )
      .collect();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const listMessages = query({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("assistantConversations"),
  },
  handler: async (ctx, { workspaceId, conversationId }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.workspaceId !== workspaceId) {
      throw new Error("Conversation not found in this workspace.");
    }
    return ctx.db
      .query("assistantMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .order("asc")
      .collect();
  },
});
