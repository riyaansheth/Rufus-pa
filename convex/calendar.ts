import { v } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
  query,
  MutationCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireWorkspaceAccess } from "./lib/auth";
import { writeAuditLog } from "./lib/audit";

/**
 * Internal calendar events live in Convex and are the fallback when Google Calendar
 * is not connected. When a Google connection exists, `createEvent` (action) also
 * mirrors the event to Google and stores the returned external id.
 */

export async function insertCalendarEventDoc(
  ctx: MutationCtx,
  actorUserId: string,
  args: {
    workspaceId: Id<"workspaces">;
    title: string;
    description?: string;
    startAt: number;
    endAt: number;
    location?: string;
    attendees?: string[];
    source?: "internal" | "google";
    externalId?: string;
  },
): Promise<Id<"calendarEvents">> {
  const title = args.title.trim();
  if (!title) throw new Error("Event title is required.");
  if (!(args.endAt > args.startAt)) {
    throw new Error("Event end time must be after start time.");
  }
  const now = Date.now();
  const id = await ctx.db.insert("calendarEvents", {
    workspaceId: args.workspaceId,
    title,
    description: args.description?.trim() || undefined,
    startAt: args.startAt,
    endAt: args.endAt,
    location: args.location?.trim() || undefined,
    attendees: args.attendees,
    source: args.source ?? "internal",
    externalId: args.externalId,
    createdBy: actorUserId,
    createdAt: now,
    updatedAt: now,
  });
  await writeAuditLog(ctx, {
    workspaceId: args.workspaceId,
    actorUserId,
    action: "calendar.event_created",
    entityType: "calendarEvent",
    entityId: id,
    metadata: { title, source: args.source ?? "internal" },
  });
  return id;
}

// Internal mutation used by the create action + assistant tool dispatch.
export const insertEvent = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    actorUserId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    location: v.optional(v.string()),
    attendees: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { actorUserId, ...args }) =>
    insertCalendarEventDoc(ctx, actorUserId, args),
});

export const attachExternal = internalMutation({
  args: {
    eventId: v.id("calendarEvents"),
    externalId: v.string(),
  },
  handler: async (ctx, { eventId, externalId }) => {
    await ctx.db.patch(eventId, {
      externalId,
      source: "google",
      updatedAt: Date.now(),
    });
  },
});

export const listUpcoming = query({
  args: { workspaceId: v.id("workspaces"), limit: v.optional(v.number()) },
  handler: async (ctx, { workspaceId, limit }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    const now = Date.now();
    const rows = await ctx.db
      .query("calendarEvents")
      .withIndex("by_workspace_start", (q) =>
        q.eq("workspaceId", workspaceId).gte("startAt", now - 3_600_000),
      )
      .order("asc")
      .take(limit ?? 25);
    return rows;
  },
});

export const listRange = query({
  args: {
    workspaceId: v.id("workspaces"),
    from: v.number(),
    to: v.number(),
  },
  handler: async (ctx, { workspaceId, from, to }) => {
    await requireWorkspaceAccess(ctx, workspaceId);
    const rows = await ctx.db
      .query("calendarEvents")
      .withIndex("by_workspace_start", (q) =>
        q.eq("workspaceId", workspaceId).gte("startAt", from).lte("startAt", to),
      )
      .order("asc")
      .collect();
    return rows;
  },
});

/** Simple internal-only event creation (used by the Calendar page form). */
export const createInternal = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    description: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireWorkspaceAccess(ctx, args.workspaceId);
    return insertCalendarEventDoc(ctx, identity.clerkUserId, args);
  },
});

/**
 * Update an event in the internal store (reschedule/rename). MVP limitation: does
 * NOT patch the mirrored Google event — callers should tell the user when the event
 * had `source === "google"` so they can adjust it in Google Calendar too.
 */
export const updateInternal = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    eventId: v.id("calendarEvents"),
    title: v.optional(v.string()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, eventId, ...patchArgs }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const event = await ctx.db.get(eventId);
    if (!event || event.workspaceId !== workspaceId) {
      throw new Error("Event not found in this workspace.");
    }
    const startAt = patchArgs.startAt ?? event.startAt;
    const endAt = patchArgs.endAt ?? event.endAt;
    if (!(endAt > startAt)) {
      throw new Error("Event end time must be after start time.");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (patchArgs.title !== undefined) patch.title = patchArgs.title.trim();
    if (patchArgs.startAt !== undefined) patch.startAt = patchArgs.startAt;
    if (patchArgs.endAt !== undefined) patch.endAt = patchArgs.endAt;
    if (patchArgs.location !== undefined) patch.location = patchArgs.location;
    await ctx.db.patch(eventId, patch);
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "calendar.event_created",
      entityType: "calendarEvent",
      entityId: eventId,
      metadata: {
        updated: true,
        changes: Object.keys(patch).filter((k) => k !== "updatedAt"),
      },
    });
    return { wasGoogleMirrored: event.source === "google" };
  },
});

/**
 * Delete a calendar event from the internal store. (For MVP this does not delete the
 * mirrored Google event; that would require a Node action + the connection tokens.)
 */
export const remove = mutation({
  args: { workspaceId: v.id("workspaces"), eventId: v.id("calendarEvents") },
  handler: async (ctx, { workspaceId, eventId }) => {
    const { identity } = await requireWorkspaceAccess(ctx, workspaceId);
    const event = await ctx.db.get(eventId);
    if (!event || event.workspaceId !== workspaceId) {
      throw new Error("Event not found in this workspace.");
    }
    await ctx.db.delete(eventId);
    await writeAuditLog(ctx, {
      workspaceId,
      actorUserId: identity.clerkUserId,
      action: "calendar.event_created",
      entityType: "calendarEvent",
      entityId: eventId,
      metadata: { deleted: true },
    });
  },
});

/**
 * Create an event, mirroring to Google Calendar when the workspace has a live
 * connection. Falls back to an internal-only event otherwise, and records an
 * `integration.failed` audit entry if the Google call errors (never throws to the
 * user for a mirror failure — the internal event is still created).
 */
export const createEvent = action({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    description: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    location: v.optional(v.string()),
    attendees: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ eventId: Id<"calendarEvents">; mirroredToGoogle: boolean }> => {
    // Verify workspace access (throws if not a member).
    await ctx.runQuery(api.memberships.myRole, { workspaceId: args.workspaceId });
    const me = await ctx.runQuery(api.users.me, {});
    const actorUserId = me?.clerkUserId;
    if (!actorUserId) throw new Error("Unauthenticated.");

    const eventId: Id<"calendarEvents"> = await ctx.runMutation(
      internal.calendar.insertEvent,
      { ...args, actorUserId },
    );

    let mirroredToGoogle = false;
    const conn = await ctx.runQuery(
      internal.calendarConnections.getConnectionInternal,
      { workspaceId: args.workspaceId, userId: actorUserId },
    );
    if (conn && conn.provider === "google" && conn.status === "connected") {
      try {
        const ext = await ctx.runAction(internal.googleCalendar.createRemoteEvent, {
          workspaceId: args.workspaceId,
          userId: actorUserId,
          title: args.title,
          description: args.description,
          startAt: args.startAt,
          endAt: args.endAt,
          location: args.location,
          attendees: args.attendees,
        });
        if (ext?.externalId) {
          await ctx.runMutation(internal.calendar.attachExternal, {
            eventId,
            externalId: ext.externalId,
          });
          mirroredToGoogle = true;
        }
      } catch (err) {
        await ctx.runMutation(internal.calendarConnections.recordFailure, {
          workspaceId: args.workspaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { eventId, mirroredToGoogle };
  },
});
