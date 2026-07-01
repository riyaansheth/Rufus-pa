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

export default http;
