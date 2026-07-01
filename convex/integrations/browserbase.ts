import type {
  AutomationProvider,
  MonitorCheckContext,
  MonitorCheckResult,
} from "./automationProvider";

/**
 * BrowserbaseProvider — PLACEHOLDER (not implemented).
 *
 * Structural stub for a future Browserbase (https://browserbase.com) headless
 * browser integration. Not wired into the cron by default. Requires BROWSERBASE_API_KEY.
 *
 * TODO(future): implement page checks that ONLY read availability/price. Must never
 * bypass captchas/queues/security or complete checkout. Add rate limiting + respect
 * each site's Terms of Service and robots directives.
 */
export class BrowserbaseProvider implements AutomationProvider {
  readonly id = "browserbase" as const;

  async check(_ctx: MonitorCheckContext): Promise<MonitorCheckResult> {
    throw new Error(
      "BrowserbaseProvider is not implemented. It is a placeholder for a future, ToS-respecting read-only monitor.",
    );
  }
}
