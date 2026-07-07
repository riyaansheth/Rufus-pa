import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Canonical audit-log actions. Keeping these as a closed set makes the audit trail
 * queryable and prevents typos from fragmenting the history.
 */
export type AuditAction =
  | "assistant.command_received"
  | "task.created"
  | "task.updated"
  | "task.deleted"
  | "reminder.created"
  | "reminder.updated"
  | "reminder.triggered"
  | "calendar.event_created"
  | "calendar.event_updated"
  | "calendar.event_deleted"
  | "monitor.created"
  | "monitor.updated"
  | "monitor.deleted"
  | "monitor.checked"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "approval.cancelled"
  | "integration.connected"
  | "integration.disconnected"
  | "integration.failed"
  | "workspace.member_joined"
  | "external.action_prepared"
  | "workspace.created"
  | "membership.role_changed";

/**
 * Append an audit-log entry. Call this for every state-changing action so the
 * `/admin/audit-logs` view reflects a complete, tamper-evident history.
 */
export async function writeAuditLog(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    actorUserId: string;
    action: AuditAction;
    entityType?: string;
    entityId?: string;
    metadata?: unknown;
  },
): Promise<void> {
  await ctx.db.insert("auditLogs", {
    workspaceId: args.workspaceId,
    actorUserId: args.actorUserId,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    metadata: args.metadata,
    createdAt: Date.now(),
  });
}

/**
 * Deliver a notification: always in-app, plus Telegram when the recipient has
 * linked the bot (reminders, approvals, briefings, monitor alerts — everything).
 */
export async function notify(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    userId: string;
    title: string;
    message?: string;
    type: string;
    href?: string;
  },
): Promise<void> {
  await ctx.db.insert("notifications", {
    workspaceId: args.workspaceId,
    userId: args.userId,
    title: args.title,
    message: args.message,
    type: args.type,
    href: args.href,
    read: false,
    createdAt: Date.now(),
  });

  // Telegram + email fan-out (best-effort, scheduled so the mutation never blocks).
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkUser", (q) => q.eq("clerkUserId", args.userId))
    .unique();
  if (user?.telegramChatId) {
    const text = args.message
      ? `${args.title}\n${args.message}`
      : args.title;
    await ctx.scheduler.runAfter(0, internal.telegram.send, {
      chatId: user.telegramChatId,
      text,
    });
  }
  // Email every notification unless the user turned it off (default ON).
  if (user?.email && user.emailNotifications !== false) {
    await ctx.scheduler.runAfter(0, internal.email.send, {
      to: user.email,
      subject: args.title,
      title: args.title,
      message: args.message,
      href: args.href,
    });
  }
}
