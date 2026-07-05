import type {
  CalendarEventInput,
  CalendarProvider,
  CreateEventResult,
  OAuthTokens,
  RemoteCalendarEvent,
} from "./calendarProvider";

/**
 * MicrosoftCalendarProvider — PLACEHOLDER (not implemented).
 *
 * This exists so the app is structurally ready for Microsoft Graph Calendar as a
 * future connector. It intentionally throws; do not present Microsoft calendar as a
 * working integration in the UI until this is implemented against Microsoft Graph
 * (https://learn.microsoft.com/graph/api/resources/calendar).
 *
 * TODO(future): implement OAuth (MSAL), token storage, and Graph /events calls.
 */
export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly id = "microsoft" as const;

  async createEvent(
    _tokens: OAuthTokens,
    _input: CalendarEventInput,
  ): Promise<CreateEventResult> {
    throw new Error(
      "MicrosoftCalendarProvider is not implemented yet. Microsoft Graph is a planned future connector.",
    );
  }

  async listUpcoming(
    _tokens: OAuthTokens,
    _opts?: { maxResults?: number },
  ): Promise<RemoteCalendarEvent[]> {
    throw new Error(
      "MicrosoftCalendarProvider is not implemented yet. Microsoft Graph is a planned future connector.",
    );
  }
}
