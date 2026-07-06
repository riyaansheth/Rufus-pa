import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Webhook } from "svix";

/**
 * Clerk webhook → user sync. Configure a Clerk webhook pointing at:
 *   https://<your-deployment>.convex.site/clerk-webhook
 * and set CLERK_WEBHOOK_SECRET on the Convex deployment
 * (`npx convex env set CLERK_WEBHOOK_SECRET whsec_...`).
 *
 * This is optional: the app also lazily syncs the signed-in user on first call
 * (users.syncCurrentUser), so it works before the webhook is configured.
 */
const http = httpRouter();

http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
      return new Response("Webhook not configured", { status: 501 });
    }
    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");
    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response("Missing svix headers", { status: 400 });
    }
    const body = await request.text();
    let event: { type: string; data: Record<string, unknown> };
    try {
      const wh = new Webhook(secret);
      event = wh.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as { type: string; data: Record<string, unknown> };
    } catch {
      return new Response("Invalid signature", { status: 400 });
    }

    if (event.type === "user.created" || event.type === "user.updated") {
      const data = event.data as {
        id: string;
        email_addresses?: { email_address: string }[];
        first_name?: string;
        last_name?: string;
        image_url?: string;
      };
      const email = data.email_addresses?.[0]?.email_address;
      const name = [data.first_name, data.last_name].filter(Boolean).join(" ");
      await ctx.runMutation(internal.users.upsertFromClerk, {
        clerkUserId: data.id,
        email,
        name: name || undefined,
        imageUrl: data.image_url,
      });
    }
    return new Response("ok", { status: 200 });
  }),
});

/**
 * Telegram bot webhook. Register once via `telegram:registerWebhook`. Verified
 * with the secret token Telegram echoes back on every update. Handles ONLY the
 * /start linking handshake — the bot is a delivery channel, not a command surface.
 */
http.route({
  path: "/telegram-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) return new Response("Not configured", { status: 501 });
    if (request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
      return new Response("Forbidden", { status: 403 });
    }
    let update: {
      message?: { chat?: { id?: number }; text?: string };
    };
    try {
      update = (await request.json()) as typeof update;
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const chatId = update.message?.chat?.id;
    const text = update.message?.text?.trim() ?? "";
    // Always 200 so Telegram doesn't retry storms; reply via sendMessage.
    if (!chatId) return new Response("ok", { status: 200 });

    let reply: string | null = null;
    const startMatch = text.match(/^\/start(?:\s+(\S+))?/);
    if (startMatch) {
      const code = startMatch[1];
      if (!code) {
        reply =
          "Hi! To link this chat to your Rufuspa account, open Rufuspa → Settings → Telegram and tap the link (or send /start <code>).";
      } else {
        const result = await ctx.runMutation(internal.telegram.linkFromWebhook, {
          code,
          chatId: String(chatId),
        });
        reply = result.reply;
      }
    } else if (text) {
      reply =
        "This bot delivers your Rufuspa notifications (reminders, approvals, briefings). Manage everything in the web app.";
    }
    if (reply) {
      await ctx.runAction(internal.telegram.send, {
        chatId: String(chatId),
        text: reply,
      });
    }
    return new Response("ok", { status: 200 });
  }),
});

export default http;
