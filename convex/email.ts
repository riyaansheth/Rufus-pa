import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Email delivery channel (Resend). One key for the whole app
 * (RESEND_API_KEY + EMAIL_FROM on the Convex deployment). Scheduled from
 * `notify()` (lib/audit.ts) so EVERY notification — reminders firing, tasks,
 * calendar updates, approvals, monitor alerts, daily briefings — is also emailed
 * to the recipient (unless they've turned email off in Settings). Best-effort:
 * a send failure never affects the in-app record.
 */

function appUrl(): string {
  return (process.env.APP_URL || "https://rufuspa.vercel.app").replace(/\/$/, "");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const send = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    title: v.string(),
    message: v.optional(v.string()),
    href: v.optional(v.string()),
  },
  handler: async (_ctx, { to, subject, title, message, href }) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { sent: false };
    const from = process.env.EMAIL_FROM || "Rufuspa <onboarding@resend.dev>";
    const link = href
      ? `${appUrl()}${href.startsWith("/") ? href : `/${href}`}`
      : appUrl();

    const html = `<div style="font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:#f5f5f7;padding:24px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #ececec">
    <div style="background:linear-gradient(135deg,#6366f1,#a855f7);padding:16px 20px;color:#fff;font-weight:600;font-size:16px">Rufuspa</div>
    <div style="padding:22px 20px">
      <h1 style="font-size:18px;line-height:1.3;margin:0 0 10px;color:#111">${esc(title)}</h1>
      ${
        message
          ? `<p style="color:#555;font-size:14px;line-height:1.5;margin:0 0 18px;white-space:pre-wrap">${esc(message)}</p>`
          : ""
      }
      <a href="${esc(link)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:500;font-size:14px">Open in Rufuspa</a>
    </div>
    <div style="padding:12px 20px;color:#999;font-size:12px;border-top:1px solid #f2f2f2">You're getting this because email notifications are on. Turn them off any time in Settings.</div>
  </div>
</div>`;

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to, subject, html }),
      });
      return { sent: res.ok };
    } catch {
      return { sent: false };
    }
  },
});
