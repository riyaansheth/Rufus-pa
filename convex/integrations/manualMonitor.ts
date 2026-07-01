import type {
  AutomationProvider,
  MonitorCheckContext,
  MonitorCheckResult,
} from "./automationProvider";

/**
 * ManualMonitorProvider — the MVP automation provider.
 *
 * It performs NO network scraping and NO headless browsing. It simply records that
 * the monitor is active and that a human should verify the condition on the linked
 * page. This is intentional: the MVP does not automate third-party sites. When a
 * real provider (Browserbase/Browserless) is added, only this class is swapped.
 */
export class ManualMonitorProvider implements AutomationProvider {
  readonly id = "manual" as const;

  async check(ctx: MonitorCheckContext): Promise<MonitorCheckResult> {
    return {
      conditionMet: false,
      requiresHumanVerification: true,
      note: ctx.url
        ? `Manual monitor active. Open the page to verify: ${ctx.url}`
        : "Manual monitor active. No automated scraping is performed in the MVP.",
      observed: {},
      checkedAt: Date.now(),
    };
  }
}
