/**
 * AutomationProvider — pluggable adapter for checking an external page's state
 * (product price, ticket availability, etc.).
 *
 * The MVP ships `ManualMonitorProvider`, which performs NO scraping and NO
 * automated browsing. `BrowserbaseProvider` and `BrowserlessProvider` are
 * placeholders showing where a real (opt-in, rate-limited, ToS-respecting) headless
 * browser integration would plug in later.
 *
 * HARD RULES for any future provider:
 *  - Never bypass captchas, queues, or website security.
 *  - Never complete a checkout, enter payment details, or read/enter OTPs.
 *  - Only observe availability/price and report back; humans approve + purchase.
 */

export type MonitorConditions = {
  priceBelow?: number;
  currency?: string;
  availability?: "in_stock" | "bookings_open" | "any";
  keyword?: string;
  [key: string]: unknown;
};

export type MonitorCheckContext = {
  type: "product" | "movie_ticket" | "event" | "generic_url";
  title: string;
  url?: string;
  conditions?: MonitorConditions;
};

export type MonitorCheckResult = {
  /** Whether the tracked condition appears to be met. */
  conditionMet: boolean;
  /** True when a human must verify (e.g. manual provider can't confirm alone). */
  requiresHumanVerification: boolean;
  /** Human-readable status note surfaced in the UI + audit log. */
  note: string;
  /** Optional observed data (e.g. { price: 4999 }). Never contains secrets. */
  observed?: Record<string, unknown>;
  checkedAt: number;
};

export interface AutomationProvider {
  readonly id: "manual" | "browserbase" | "browserless";
  check(ctx: MonitorCheckContext): Promise<MonitorCheckResult>;
}
