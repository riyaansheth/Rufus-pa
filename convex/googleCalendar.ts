"use node";

import { google } from "googleapis";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
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
 * Fresh Google access token for a user who signed in with Google via Clerk.
 * Clerk stores + auto-refreshes the social-login OAuth token; we fetch it on
 * demand so NO Google tokens ever rest in our database for this path.
 * Requires CLERK_SECRET_KEY on the Convex deployment.
 */
async function fetchClerkGoogleToken(
  clerkUserId: string,
): Promise<OAuthTokens | null> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) return null;
  try {
    const res = await fetch(
      `https://api.clerk.com/v1/users/${clerkUserId}/oauth_access_tokens/oauth_google`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    const arr = Array.isArray(body)
      ? body
      : ((body as { data?: unknown[] })?.data ?? []);
    const tok = arr[0] as
      | { token?: string; expires_at?: number }
      | undefined;
    if (!tok?.token) return null;
    return { accessToken: tok.token, expiresAt: tok.expires_at ?? undefined };
  } catch {
    return null;
  }
}

/** Resolve usable Google tokens for a connection, whatever its source. */
async function resolveTokens(conn: {
  tokenSource?: "oauth" | "clerk";
  userId: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}): Promise<OAuthTokens | null> {
  if (conn.tokenSource === "clerk") {
    return fetchClerkGoogleToken(conn.userId);
  }
  if (!conn.accessToken) return null;
  return {
    accessToken: conn.accessToken,
    refreshToken: conn.refreshToken ?? undefined,
    expiresAt: conn.expiresAt ?? undefined,
    scope: conn.scope ?? undefined,
  };
}

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
    if (!conn) {
      throw new Error("No connected Google Calendar for this workspace.");
    }
    const tokens = await resolveTokens(conn);
    if (!tokens) {
      throw new Error("No usable Google Calendar credentials for this workspace.");
    }
    const input: CalendarEventInput = {
      title: args.title,
      description: args.description,
      startAt: args.startAt,
      endAt: args.endAt,
      location: args.location,
      attendees: args.attendees,
    };
    const { event, refreshed } = await provider.createEvent(tokens, input);
    // Persist a refreshed access token so we don't re-refresh on every call
    // (only relevant for stored-token connections; Clerk fetches fresh each time).
    if (refreshed?.accessToken && conn.tokenSource !== "clerk") {
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
    if (!conn || conn.provider !== "google" || conn.status !== "connected") {
      return { synced: false };
    }
    const tokens = await resolveTokens(conn);
    if (!tokens) return { synced: false };

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
      if (refreshed?.accessToken && conn.tokenSource !== "clerk") {
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

/**
 * PUBLIC action: the signed-in user's upcoming Google Calendar events for a
 * workspace (read-only; used by the Calendar page to show the real Google
 * calendar alongside internal events). Returns no tokens — event data only.
 */
export const listGoogleEvents = action({
  args: { workspaceId: v.id("workspaces"), maxResults: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    connected: boolean;
    events: Array<{
      externalId: string;
      title?: string;
      start?: string;
      end?: string;
      htmlLink?: string;
    }>;
    error?: string;
  }> => {
    // Verify workspace membership (throws if not a member).
    await ctx.runQuery(api.memberships.myRole, { workspaceId: args.workspaceId });
    const me = await ctx.runQuery(api.users.me, {});
    if (!me?.clerkUserId) throw new Error("Unauthenticated.");

    const conn = await ctx.runQuery(
      internal.calendarConnections.getConnectionInternal,
      { workspaceId: args.workspaceId, userId: me.clerkUserId },
    );
    if (!conn || conn.provider !== "google" || conn.status !== "connected") {
      return { connected: false, events: [] };
    }
    const tokens = await resolveTokens(conn);
    if (!tokens) return { connected: false, events: [] };
    try {
      const events = await provider.listUpcoming(tokens, {
        maxResults: Math.min(args.maxResults ?? 30, 100),
      });
      return { connected: true, events };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.calendarConnections.recordFailure, {
        workspaceId: args.workspaceId,
        error: msg,
      });
      return { connected: true, events: [], error: msg };
    }
  },
});
