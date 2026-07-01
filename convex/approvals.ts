import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import {
  APPROVER_ROLES,
  requireWorkspaceAccess,
} from "./lib/auth";
import { notify, writeAuditLog } from "./lib/audit";
import { approvalStatusValidator, approvalTypeValidator } from "./schema";

/**
 * Create an approval request. This is the SAFE substitute for any sensitive or
 * money-related action: the assistant/monitors never execute a purchase or booking,
 * they only prepare a request that a human with approval rights must accept.
 *
 * The payload must never contain payment secrets, OTP, CVV, UPI PIN, or passwords.
 */
export async function insertApprovalRequest(
  ctx: MutationCtx,
  requestedBy: string,
  args: {
    workspaceId: Id<"workspaces">;
    type: "purchase_request" | "ticket_booking_request" | "external_website_action" | "calendar_action_if_needed";
    title: string;
    description?: string;
    payload?: unknown;
    amount?: number;
    currency?: string;
  },
): Promise<Id<"approvalRequests">> {
  const title = args.title.trim();
  if (!title) throw new Error("Approval request title is required.");
  const now = Date.now();
  const id = await ctx.db.insert("approvalRequests", {
    workspaceId: args.workspaceId,
    type: args.type,
    title,
    description: args.description?.trim() || undefined,
    payload: args.payload,
    amount: args.amount,
    currency: args.currency ?? (args.amount !== undefined ? "INR" : undefined),
    status: "pending",
    requestedBy,
    createdAt: now,
    updatedAt: now,
  });
  await writeAuditLog(ctx, {
    workspaceId: args.workspaceId,
    actorUserId: requestedBy,
    action: "approval.requested",
    entityType: "approvalRequest",
    entityId: id,
    metadata: { type: args.type, title, amount: args.amount },
  });

  // Notify everyone who can approve (owner/admin/approver).
  const members = await ctx.db
    .query("memberships")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
    .collect();
  for (const m of members) {
    if (APPROVER_ROLES.includes(m.role)) {
      await notify(ctx, {
        workspaceId: args.workspaceId,
        userId: m.userId,
        title: "Approval needed",
        message: title,
        type: "approval_request",
        href: "/approvals",
      });
    }
  }
  return id;
}

export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    status: v.optional(approvalStatusValidator),
  },
  handler: async (ctx, { workspaceId, status }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    const rows = status
      ? await ctx.db
          .query("approvalRequests")
          .withIndex("by_workspace_status", (q) =>
            q.eq("workspaceId", workspaceId).eq("status", status),
          )
          .order("desc")
          .collect()
      : await ctx.db
          .query("approvalRequests")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .order("desc")
          .collect();
    return rows;
  },
});

export const listPending = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    return ctx.db
      .query("approvalRequests")
      .withIndex("by_workspace_status", (q) =>
        q.eq("workspaceId", workspaceId).eq("status", "pending"),
      )
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    type: approvalTypeValidator,
    title: v.string(),
    description: v.optional(v.string()),
    payload: v.optional(v.any()),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireWorkspaceAccess(ctx, args.workspaceId);
    return insertApprovalRequest(ctx, identity.clerkUserId, args);
  },
});

/**
 * Approve or reject a request. Requires owner/admin/approver role. Every decision
 * is audit-logged and the requester is notified.
 */
export const decide = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    approvalId: v.id("approvalRequests"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, approvalId, decision, note }) => {
    const { identity } = await requireWorkspaceAccess(
      ctx,
      workspaceId,
      APPROVER_ROLES,
    );
    const request = await ctx.db.get(approvalId);
    if (!request || request.workspaceId !== workspaceId) {
      throw new Error("Approval request not found in this workspace.");
    }
    if (request.status !== "pending") {
      throw new Error(`This request is already ${request.status}.`);
    }
    await ctx.db.patch(approvalId, {
      status: decision,
      approvedBy: identity.clerkUserId,
      decisionNote: note?.trim() || undefined,
      updatedAt: Date.now(),
    });
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: decision === "approved" ? "approval.approved" : "approval.rejected",
      entityType: "approvalRequest",
      entityId: approvalId,
      metadata: { title: request.title, note },
    });
    await notify(ctx, {
      workspaceId,
      userId: request.requestedBy,
      title: `Request ${decision}`,
      message: request.title,
      type: "approval_decision",
      href: "/approvals",
    });
  },
});

export const cancel = mutation({
  args: { workspaceId: v.id("workspaces"), approvalId: v.id("approvalRequests") },
  handler: async (ctx, { workspaceId, approvalId }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const request = await ctx.db.get(approvalId);
    if (!request || request.workspaceId !== workspaceId) {
      throw new Error("Approval request not found in this workspace.");
    }
    // Requester may cancel their own pending request; approvers may cancel any.
    const canManage =
      request.requestedBy === identity.clerkUserId ||
      APPROVER_ROLES.includes(
        (await requireWorkspaceAccess(ctx, workspaceId)).role,
      );
    if (!canManage) throw new Error("You cannot cancel this request.");
    if (request.status !== "pending") {
      throw new Error(`This request is already ${request.status}.`);
    }
    await ctx.db.patch(approvalId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "approval.cancelled",
      entityType: "approvalRequest",
      entityId: approvalId,
    });
  },
});
