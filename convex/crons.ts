import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Scheduled jobs.
 *
 * These are intentionally gentle: reminders are swept once a minute, monitors every
 * five minutes (each monitor also has its own checkFrequencyMinutes gate). No
 * aggressive polling of third-party sites — the MVP provider does no scraping at all.
 */
const crons = cronJobs();

crons.interval(
  "trigger-due-reminders",
  { minutes: 1 },
  internal.scheduled.triggerDueReminders,
  {},
);

crons.interval(
  "run-monitor-checks",
  { minutes: 5 },
  internal.scheduled.runMonitorChecks,
  {},
);

// Every 30 min so half-hour timezones (e.g. IST) still get their briefing within
// the chosen local hour. Dedupes per user per local day.
crons.interval(
  "send-daily-briefings",
  { minutes: 30 },
  internal.scheduled.sendDailyBriefings,
  {},
);

export default crons;
