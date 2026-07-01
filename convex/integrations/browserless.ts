import type {
  AutomationProvider,
  MonitorCheckContext,
  MonitorCheckResult,
} from "./automationProvider";

/**
 * BrowserlessProvider — PLACEHOLDER (not implemented).
 *
 * Structural stub for a future Browserless (https://browserless.io) integration.
 * Not wired into the cron by default. Requires BROWSERLESS_TOKEN.
 *
 * TODO(future): implement read-only availability/price checks. Must never bypass
 * captchas/queues/security or complete checkout. Add rate limiting + ToS compliance.
 */
export class BrowserlessProvider implements AutomationProvider {
  readonly id = "browserless" as const;

  async check(_ctx: MonitorCheckContext): Promise<MonitorCheckResult> {
    throw new Error(
      "BrowserlessProvider is not implemented. It is a placeholder for a future, ToS-respecting read-only monitor.",
    );
  }
}
