import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";

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

/** Create an in-app notification (MVP delivery channel). */
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
}
