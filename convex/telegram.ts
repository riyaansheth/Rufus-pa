import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { requireIdentity } from "./lib/auth";

/**
 * Telegram delivery channel.
 *
 * One bot serves the whole app (TELEGRAM_BOT_TOKEN on the Convex deployment).
 * A user links their account by sending the bot `/start <code>` (the Settings page
 * shows a tap-to-open deep link). Once linked, every in-app notification —
 * reminders firing, approvals waiting, daily briefings, monitor alerts — is also
 * pushed to their Telegram chat (see `notify()` in lib/audit.ts).
 *
 * Security: the webhook (convex/http.ts) verifies Telegram's secret token header.
 * The bot only ever SENDS notifications and handles /start linking — it executes
 * no commands and never touches money/OTP flows.
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Linking status for the Settings page (never exposes the chat id itself). */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkUser", (q) => q.eq("clerkUserId", identity.subject))
      .unique();
    return {
      linked: Boolean(user?.telegramChatId),
      pendingCode: user?.telegramChatId ? null : (user?.telegramLinkCode ?? null),
      botUsername: process.env.TELEGRAM_BOT_USERNAME ?? null,
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    };
  },
});

/** Create (or refresh) the one-time link code shown in Settings. */
export const generateLinkCode = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkUser", (q) =>
        q.eq("clerkUserId", identity.clerkUserId),
      )
      .unique();
    if (!user) throw new Error("User not found — reload and try again.");
    const code = generateCode();
    await ctx.db.patch(user._id, {
      telegramLinkCode: code,
      updatedAt: Date.now(),
    });
    return code;
  },
});

/** Disconnect Telegram delivery. */
export const unlink = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkUser", (q) =>
        q.eq("clerkUserId", identity.clerkUserId),
      )
      .unique();
    if (user) {
      await ctx.db.patch(user._id, {
        telegramChatId: undefined,
        telegramLinkCode: undefined,
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * INTERNAL — called by the webhook when someone sends `/start <code>`.
 * Returns a human reply for the bot to send back.
 */
export const linkFromWebhook = internalMutation({
  args: { code: v.string(), chatId: v.string() },
  handler: async (ctx, { code, chatId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramLinkCode", (q) =>
        q.eq("telegramLinkCode", code.trim().toUpperCase()),
      )
      .unique();
    if (!user) {
      return {
        ok: false,
        reply:
          "That link code wasn't recognized. Open Rufuspa → Settings → Telegram and use the current code.",
      };
    }
    await ctx.db.patch(user._id, {
      telegramChatId: chatId,
      telegramLinkCode: undefined,
      updatedAt: Date.now(),
    });
    return {
      ok: true,
      reply:
        "✅ Linked! You'll now get your Rufuspa reminders, approvals, and daily briefings here.",
    };
  },
});

/** INTERNAL — send a Telegram message (scheduled from notify()). Best-effort. */
export const send = internalAction({
  args: { chatId: v.string(), text: v.string() },
  handler: async (_ctx, { chatId, text }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { sent: false };
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: text.slice(0, 4000),
            disable_web_page_preview: true,
          }),
        },
      );
      return { sent: res.ok };
    } catch {
      return { sent: false };
    }
  },
});

/**
 * INTERNAL — register the webhook with Telegram. Run once after setting
 * TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET:
 *   npx convex run telegram:registerWebhook '{"siteUrl":"https://<deployment>.convex.site"}'
 */
export const registerWebhook = internalAction({
  args: { siteUrl: v.string() },
  handler: async (_ctx, { siteUrl }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!token || !secret) {
      throw new Error(
        "Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET on the Convex deployment first.",
      );
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `${siteUrl.replace(/\/$/, "")}/telegram-webhook`,
        secret_token: secret,
        allowed_updates: ["message"],
      }),
    });
    const body = (await res.json()) as { ok?: boolean; description?: string };
    if (!body.ok) {
      throw new Error(`Telegram setWebhook failed: ${body.description}`);
    }
    return { ok: true };
  },
});
