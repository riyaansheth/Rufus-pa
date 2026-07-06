import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Rufuspa data model.
 *
 * Every domain table carries `workspaceId` and is only ever read/written through
 * helpers that enforce workspace membership (see `convex/lib/auth.ts`). This is the
 * single most important isolation guarantee in the app: no query returns rows for a
 * workspace the caller is not a member of.
 */

// --- Shared literal unions -------------------------------------------------

export const roleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
  v.literal("approver"),
);

export const taskStatusValidator = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("done"),
  v.literal("cancelled"),
);

export const priorityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

export const reminderStatusValidator = v.union(
  v.literal("scheduled"),
  v.literal("triggered"),
  v.literal("cancelled"),
);

export const approvalTypeValidator = v.union(
  v.literal("purchase_request"),
  v.literal("ticket_booking_request"),
  v.literal("external_website_action"),
  v.literal("calendar_action_if_needed"),
);

export const approvalStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("cancelled"),
);

export const monitorTypeValidator = v.union(
  v.literal("product"),
  v.literal("movie_ticket"),
  v.literal("event"),
  v.literal("generic_url"),
);

export const monitorStatusValidator = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("completed"),
  v.literal("failed"),
);

export const calendarProviderValidator = v.union(
  v.literal("google"),
  v.literal("microsoft"),
);

export default defineSchema({
  // --- Identity & workspaces ---------------------------------------------
  users: defineTable({
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    // IANA timezone captured from the browser; used for the daily briefing hour.
    timezone: v.optional(v.string()),
    // Proactive daily-briefing preferences (in-app notification each morning).
    briefingEnabled: v.optional(v.boolean()),
    briefingHour: v.optional(v.number()), // local hour 0-23, default 8
    lastBriefingSentAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_clerkUser", ["clerkUserId"]),

  workspaces: defineTable({
    name: v.string(),
    slug: v.string(),
    createdBy: v.string(), // clerkUserId
    // Shareable code others use to join this workspace (as "member").
    inviteCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_inviteCode", ["inviteCode"])
    .index("by_createdAt", ["createdAt"]),

  memberships: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(), // clerkUserId
    role: roleValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  // --- Tasks & reminders --------------------------------------------------
  tasks: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    description: v.optional(v.string()),
    status: taskStatusValidator,
    priority: priorityValidator,
    dueAt: v.optional(v.number()),
    assignedTo: v.optional(v.string()), // clerkUserId
    // Google Calendar event mirroring this task's due date (when Google connected).
    googleEventId: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_workspace_user", ["workspaceId", "assignedTo"])
    .index("by_dueAt", ["dueAt"]),

  reminders: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    message: v.optional(v.string()),
    remindAt: v.number(),
    status: reminderStatusValidator,
    // Google Calendar event mirroring this reminder (when Google connected).
    googleEventId: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_remindAt", ["remindAt"])
    // Cron sweeps only "scheduled" reminders that are due; this keeps the read
    // bounded instead of re-scanning every already-triggered reminder each minute.
    .index("by_status_remindAt", ["status", "remindAt"]),

  // --- Calendar -----------------------------------------------------------
  calendarConnections: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(), // clerkUserId who connected the account
    provider: calendarProviderValidator,
    accountEmail: v.optional(v.string()),
    // NOTE: tokens are stored server-side only and never returned to the client.
    // TODO(production): encrypt these fields at rest with a KMS-managed key.
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
    status: v.union(v.literal("connected"), v.literal("error"), v.literal("revoked")),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  calendarEvents: defineTable({
    workspaceId: v.id("workspaces"),
    title: v.string(),
    description: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    location: v.optional(v.string()),
    attendees: v.optional(v.array(v.string())),
    // "internal" = stored only in Convex; "google" = mirrored to Google Calendar.
    source: v.union(v.literal("internal"), v.literal("google")),
    externalId: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_startAt", ["startAt"])
    .index("by_workspace_start", ["workspaceId", "startAt"]),

  // --- Assistant ----------------------------------------------------------
  assistantConversations: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),

  assistantMessages: defineTable({
    workspaceId: v.id("workspaces"),
    conversationId: v.id("assistantConversations"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("tool"),
      v.literal("system"),
    ),
    content: v.string(),
    // Structured suggestions/actions surfaced to the UI (e.g. links to created records).
    actions: v.optional(
      v.array(
        v.object({
          kind: v.string(),
          label: v.string(),
          entityType: v.optional(v.string()),
          entityId: v.optional(v.string()),
          href: v.optional(v.string()),
        }),
      ),
    ),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_workspace_conversation", ["workspaceId", "conversationId"]),

  // --- Approvals ----------------------------------------------------------
  approvalRequests: defineTable({
    workspaceId: v.id("workspaces"),
    type: approvalTypeValidator,
    title: v.string(),
    description: v.optional(v.string()),
    // Arbitrary structured context (item url, monitor id, booking page, ...).
    // NEVER contains payment secrets, OTP, CVV, UPI PIN, or passwords — by design.
    payload: v.optional(v.any()),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    status: approvalStatusValidator,
    requestedBy: v.string(),
    approvedBy: v.optional(v.string()),
    decisionNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_createdAt", ["createdAt"]),

  // --- Monitors -----------------------------------------------------------
  monitors: defineTable({
    workspaceId: v.id("workspaces"),
    type: monitorTypeValidator,
    title: v.string(),
    url: v.optional(v.string()),
    // e.g. { priceBelow: 5000, currency: "INR" } or { availability: "in_stock" }
    conditions: v.optional(v.any()),
    status: monitorStatusValidator,
    checkFrequencyMinutes: v.number(),
    lastCheckedAt: v.optional(v.number()),
    lastResult: v.optional(v.any()),
    // When a monitor should create a purchase request on success.
    autoPrepareApproval: v.optional(v.boolean()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_status", ["workspaceId", "status"])
    .index("by_status", ["status"]),

  // --- Audit & notifications ---------------------------------------------
  auditLogs: defineTable({
    workspaceId: v.id("workspaces"),
    actorUserId: v.string(),
    action: v.string(),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_createdAt", ["workspaceId", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  notifications: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    title: v.string(),
    message: v.optional(v.string()),
    type: v.string(),
    href: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_user", ["workspaceId", "userId"]),
});
