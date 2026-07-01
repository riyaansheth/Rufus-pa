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

export interface CalendarProvider {
  readonly id: "google" | "microsoft";
  /** Create an event in the remote calendar and return its external id. */
  createEvent(
    tokens: OAuthTokens,
    input: CalendarEventInput,
  ): Promise<RemoteCalendarEvent>;
  /** List upcoming events from the remote calendar. */
  listUpcoming(
    tokens: OAuthTokens,
    opts?: { maxResults?: number },
  ): Promise<RemoteCalendarEvent[]>;
}
