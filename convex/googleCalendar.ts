"use node";

import { google } from "googleapis";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import type {
  CalendarEventInput,
  CalendarProvider,
  MutateEventResult,
  OAuthTokens,
  RemoteCalendarEvent,
} from "./integrations/calendarProvider";

/**
 * GoogleCalendarProvider — real implementation of CalendarProvider backed by the
 * Google Calendar API. Runs in Convex's Node runtime ("use node") because the
 * googleapis SDK requires Node APIs.
 *
 * Security: tokens are received as arguments (loaded server-side from
 * calendarConnections) and never leave the server. The OAuth2 client auto-refreshes
 * the access token when a refresh token is present.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = "google" as const;

  private client() {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );
    return oauth2;
  }

  /** Authed client + a getter for any auto-refreshed access token. */
  private authed(tokens: OAuthTokens) {
    const auth = this.client();
    auth.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt,
    });
    let refreshed: { accessToken: string; expiresAt?: number } | undefined;
    auth.on("tokens", (t) => {
      if (t.access_token) {
        refreshed = {
          accessToken: t.access_token,
          expiresAt: t.expiry_date ?? undefined,
        };
      }
    });
    return { auth, getRefreshed: () => refreshed };
  }

  async createEvent(
    tokens: OAuthTokens,
    input: CalendarEventInput,
  ): Promise<{
    event: RemoteCalendarEvent;
    refreshed?: { accessToken: string; expiresAt?: number };
  }> {
    const { auth, getRefreshed } = this.authed(tokens);
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: input.title,
        description: input.description,
        location: input.location,
        start: { dateTime: new Date(input.startAt).toISOString() },
        end: { dateTime: new Date(input.endAt).toISOString() },
        attendees: input.attendees?.map((email) => ({ email })),
      },
    });
    return {
      event: {
        externalId: res.data.id ?? "",
        htmlLink: res.data.htmlLink ?? undefined,
        start: res.data.start?.dateTime ?? undefined,
        end: res.data.end?.dateTime ?? undefined,
        title: res.data.summary ?? undefined,
      },
      refreshed: getRefreshed(),
    };
  }

  async updateEvent(
    tokens: OAuthTokens,
    externalId: string,
    input: Partial<CalendarEventInput>,
  ): Promise<MutateEventResult> {
    const { auth, getRefreshed } = this.authed(tokens);
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.patch({
      calendarId: "primary",
      eventId: externalId,
      requestBody: {
        ...(input.title !== undefined ? { summary: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.startAt !== undefined
          ? { start: { dateTime: new Date(input.startAt).toISOString() } }
          : {}),
        ...(input.endAt !== undefined
          ? { end: { dateTime: new Date(input.endAt).toISOString() } }
          : {}),
      },
    });
    return { refreshed: getRefreshed() };
  }

  async deleteEvent(
    tokens: OAuthTokens,
    externalId: string,
  ): Promise<MutateEventResult> {
    const { auth, getRefreshed } = this.authed(tokens);
    const calendar = google.calendar({ version: "v3", auth });
    try {
      await calendar.events.delete({ calendarId: "primary", eventId: externalId });
    } catch (err) {
      // Already gone in Google (user deleted it there) — that's fine.
      const code = (err as { code?: number }).code;
      if (code !== 404 && code !== 410) throw err;
    }
    return { refreshed: getRefreshed() };
  }

  async listUpcoming(
    tokens: OAuthTokens,
    opts?: { maxResults?: number },
  ): Promise<RemoteCalendarEvent[]> {
    const auth = this.client();
    auth.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt,
    });
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: opts?.maxResults ?? 20,
    });
    return (res.data.items ?? []).map((e) => ({
      externalId: e.id ?? "",
      htmlLink: e.htmlLink ?? undefined,
      start: e.start?.dateTime ?? e.start?.date ?? undefined,
      end: e.end?.dateTime ?? e.end?.date ?? undefined,
      title: e.summary ?? undefined,
    }));
  }
}

const provider = new GoogleCalendarProvider();

/**
 * INTERNAL action: create an event in the workspace's connected Google Calendar.
 * Loads tokens server-side; the caller (convex/calendar.ts createEvent) handles the
 * fallback to an internal-only event when this is unavailable or fails.
 */
export const createRemoteEvent = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    location: v.optional(v.string()),
    attendees: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ externalId: string; htmlLink?: string }> => {
    const conn = await ctx.runQuery(
      internal.calendarConnections.getConnectionInternal,
      { workspaceId: args.workspaceId, userId: args.userId },
    );
    if (!conn || !conn.accessToken) {
      throw new Error("No connected Google Calendar for this workspace.");
    }
    const input: CalendarEventInput = {
      title: args.title,
      description: args.description,
      startAt: args.startAt,
      endAt: args.endAt,
      location: args.location,
      attendees: args.attendees,
    };
    const { event, refreshed } = await provider.createEvent(
      {
        accessToken: conn.accessToken,
        refreshToken: conn.refreshToken ?? undefined,
        expiresAt: conn.expiresAt ?? undefined,
        scope: conn.scope ?? undefined,
      },
      input,
    );
    // Persist a refreshed access token so we don't re-refresh on every call.
    if (refreshed?.accessToken) {
      await ctx.runMutation(internal.calendarConnections.updateAccessToken, {
        workspaceId: args.workspaceId,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      });
    }
    return { externalId: event.externalId, htmlLink: event.htmlLink };
  },
});

/**
 * INTERNAL: one-shot Google Calendar sync used by task/reminder/event mutations
 * (scheduled via ctx.scheduler so DB writes never block on the network).
 *
 * Best-effort by design: any Google failure is recorded on the connection
 * (integration.failed) and never breaks the in-app record.
 */
export const syncItem = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.optional(v.string()),
    op: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
    googleEventId: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    // Where to store the created Google event id.
    writeBack: v.optional(
      v.object({
        table: v.union(v.literal("tasks"), v.literal("reminders")),
        id: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const conn = await ctx.runQuery(
      internal.calendarConnections.getConnectionInternal,
      { workspaceId: args.workspaceId, userId: args.userId },
    );
    if (
      !conn ||
      conn.provider !== "google" ||
      conn.status !== "connected" ||
      !conn.accessToken
    ) {
      return { synced: false };
    }
    const tokens: OAuthTokens = {
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken ?? undefined,
      expiresAt: conn.expiresAt ?? undefined,
    };

    try {
      let refreshed: { accessToken: string; expiresAt?: number } | undefined;
      if (args.op === "create") {
        if (!args.title || args.startAt === undefined || args.endAt === undefined) {
          return { synced: false };
        }
        const res = await provider.createEvent(tokens, {
          title: args.title,
          description: args.description,
          startAt: args.startAt,
          endAt: args.endAt,
        });
        refreshed = res.refreshed;
        if (res.event.externalId && args.writeBack) {
          if (args.writeBack.table === "tasks") {
            await ctx.runMutation(internal.tasks.setGoogleEventId, {
              taskId: args.writeBack.id as Id<"tasks">,
              googleEventId: res.event.externalId,
            });
          } else {
            await ctx.runMutation(internal.reminders.setGoogleEventId, {
              reminderId: args.writeBack.id as Id<"reminders">,
              googleEventId: res.event.externalId,
            });
          }
        }
      } else if (args.op === "update") {
        if (!args.googleEventId) return { synced: false };
        const res = await provider.updateEvent(tokens, args.googleEventId, {
          title: args.title,
          description: args.description,
          startAt: args.startAt,
          endAt: args.endAt,
        });
        refreshed = res.refreshed;
      } else {
        if (!args.googleEventId) return { synced: false };
        const res = await provider.deleteEvent(tokens, args.googleEventId);
        refreshed = res.refreshed;
      }
      if (refreshed?.accessToken) {
        await ctx.runMutation(internal.calendarConnections.updateAccessToken, {
          workspaceId: args.workspaceId,
          accessToken: refreshed.accessToken,
          expiresAt: refreshed.expiresAt,
        });
      }
      return { synced: true };
    } catch (err) {
      await ctx.runMutation(internal.calendarConnections.recordFailure, {
        workspaceId: args.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { synced: false };
    }
  },
});
