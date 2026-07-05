"use node";

import { google } from "googleapis";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type {
  CalendarEventInput,
  CalendarProvider,
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

  async createEvent(
    tokens: OAuthTokens,
    input: CalendarEventInput,
  ): Promise<{
    event: RemoteCalendarEvent;
    refreshed?: { accessToken: string; expiresAt?: number };
  }> {
    const auth = this.client();
    auth.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt,
    });
    // Capture an auto-refreshed access token so callers can persist it.
    let refreshed: { accessToken: string; expiresAt?: number } | undefined;
    auth.on("tokens", (t) => {
      if (t.access_token) {
        refreshed = {
          accessToken: t.access_token,
          expiresAt: t.expiry_date ?? undefined,
        };
      }
    });
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
      refreshed,
    };
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
