/**
 * CalendarProvider — the pluggable calendar abstraction.
 *
 * The app talks to calendars only through this shape. `GoogleCalendarProvider`
 * (convex/googleCalendar.ts) implements it today; `MicrosoftCalendarProvider`
 * (convex/integrations/microsoftCalendar.ts) is a placeholder for a future
 * Microsoft Graph connector. Adding a provider = implementing this interface and
 * wiring one action — no changes to callers.
 */

export type CalendarEventInput = {
  title: string;
  description?: string;
  startAt: number; // epoch ms
  endAt: number; // epoch ms
  location?: string;
  attendees?: string[]; // email addresses
};

export type RemoteCalendarEvent = {
  externalId: string;
  htmlLink?: string;
  start?: string;
  end?: string;
  title?: string;
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
};

export type CreateEventResult = {
  event: RemoteCalendarEvent;
  /** A refreshed access token, if the provider auto-refreshed during the call. */
  refreshed?: { accessToken: string; expiresAt?: number };
};

export type MutateEventResult = {
  /** A refreshed access token, if the provider auto-refreshed during the call. */
  refreshed?: { accessToken: string; expiresAt?: number };
};

export interface CalendarProvider {
  readonly id: "google" | "microsoft";
  /** Create an event in the remote calendar and return its external id. */
  createEvent(
    tokens: OAuthTokens,
    input: CalendarEventInput,
  ): Promise<CreateEventResult>;
  /** Patch an existing remote event (title/time/description). */
  updateEvent(
    tokens: OAuthTokens,
    externalId: string,
    input: Partial<CalendarEventInput>,
  ): Promise<MutateEventResult>;
  /** Delete a remote event. Must tolerate already-deleted events. */
  deleteEvent(
    tokens: OAuthTokens,
    externalId: string,
  ): Promise<MutateEventResult>;
  /**
   * List events from the remote calendar. Defaults to upcoming events; pass
   * timeMin/timeMax (epoch ms) to fetch an explicit window (e.g. a month grid).
   */
  listUpcoming(
    tokens: OAuthTokens,
    opts?: { maxResults?: number; timeMin?: number; timeMax?: number },
  ): Promise<RemoteCalendarEvent[]>;
}
