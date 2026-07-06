import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { writeAuditLog, notify } from "./lib/audit";
import { insertApprovalRequest } from "./approvals";
import { ManualMonitorProvider } from "./integrations/manualMonitor";
import type { MonitorConditions } from "./integrations/automationProvider";
import { currentHourInTz, todayWindowInTz } from "./lib/time";

/**
 * System cron handlers. These run without a user identity, so they operate across
 * all workspaces but only touch rows they own by workspaceId. They never bypass the
 * approval flow: a met condition creates an approval REQUEST, never a purchase.
 */

// The MVP provider performs no scraping. Swap here to enable a real provider later.
const monitorProvider = new ManualMonitorProvider();

// --- Reminders -------------------------------------------------------------

/** Trigger all scheduled reminders whose time has passed. */
export const triggerDueReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Only scan reminders that are still scheduled AND due — bounded per sweep.
    const due = await ctx.db
      .query("reminders")
      .withIndex("by_status_remindAt", (q) =>
        q.eq("status", "scheduled").lte("remindAt", now),
      )
      .collect();
    let triggered = 0;
    for (const r of due) {
      await ctx.db.patch(r._id, { status: "triggered", updatedAt: now });
      await notify(ctx, {
        workspaceId: r.workspaceId,
        userId: r.createdBy,
        title: `Reminder: ${r.title}`,
        message: r.message,
        type: "reminder",
        href: "/reminders",
      });
      await writeAuditLog(ctx, {
        workspaceId: r.workspaceId,
        actorUserId: r.createdBy,
        action: "reminder.triggered",
        entityType: "reminder",
        entityId: r._id,
        metadata: { title: r.title },
      });
      triggered++;
    }
    return { triggered };
  },
});

// --- Monitors --------------------------------------------------------------

export const listMonitorsDue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const active = await ctx.db
      .query("monitors")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    return active.filter((m) => {
      const intervalMs = Math.max(5, m.checkFrequencyMinutes) * 60_000;
      return !m.lastCheckedAt || now - m.lastCheckedAt >= intervalMs;
    });
  },
});

export const applyMonitorCheck = internalMutation({
  args: {
    monitorId: v.id("monitors"),
    result: v.object({
      conditionMet: v.boolean(),
      requiresHumanVerification: v.boolean(),
      note: v.string(),
      observed: v.optional(v.any()),
      checkedAt: v.number(),
    }),
  },
  handler: async (ctx, { monitorId, result }) => {
    const monitor = await ctx.db.get(monitorId);
    if (!monitor) return;
    await ctx.db.patch(monitorId, {
      lastCheckedAt: result.checkedAt,
      lastResult: result,
      updatedAt: Date.now(),
    });
    await writeAuditLog(ctx, {
      workspaceId: monitor.workspaceId,
      actorUserId: monitor.createdBy,
      action: "monitor.checked",
      entityType: "monitor",
      entityId: monitorId,
      metadata: { note: result.note, conditionMet: result.conditionMet },
    });

    // If (and only if) a real provider confirms the condition, prepare an approval
    // request — NEVER a purchase. The MVP manual provider never sets conditionMet.
    if (result.conditionMet && monitor.autoPrepareApproval) {
      // Alert the person who set the monitor directly (in-app + Telegram), with
      // the booking/product link right in the message.
      await notify(ctx, {
        workspaceId: monitor.workspaceId,
        userId: monitor.createdBy,
        title:
          monitor.type === "movie_ticket" || monitor.type === "event"
            ? `🎟️ ${monitor.title} — bookings look open!`
            : `🔔 ${monitor.title} — condition met!`,
        message: monitor.url
          ? `Complete it yourself here (seats/payment/OTP are always yours):\n${monitor.url}`
          : "Check the monitor for details.",
        type: "monitor_alert",
        href: "/monitors",
      });
      const conditions = (monitor.conditions ?? {}) as MonitorConditions;
      await insertApprovalRequest(ctx, monitor.createdBy, {
        workspaceId: monitor.workspaceId,
        type:
          monitor.type === "movie_ticket"
            ? "ticket_booking_request"
            : "purchase_request",
        title: `Approve: ${monitor.title}`,
        description:
          "A monitored condition was met. Review and approve before any human-completed checkout. The assistant will NOT complete payment, OTP, or booking.",
        payload: {
          monitorId,
          url: monitor.url,
          observed: result.observed,
        },
        amount: conditions.priceBelow,
        currency: conditions.currency ?? "INR",
      });
      await ctx.db.patch(monitorId, { status: "completed", updatedAt: Date.now() });
    }
  },
});

/** Run all due monitor checks via the configured (manual) provider. */
export const runMonitorChecks = internalAction({
  args: {},
  handler: async (ctx) => {
    const due: Array<{
      _id: Id<"monitors">;
      type: "product" | "movie_ticket" | "event" | "generic_url";
      title: string;
      url?: string;
      conditions?: unknown;
    }> = await ctx.runQuery(internal.scheduled.listMonitorsDue, {});
    let checked = 0;
    let failed = 0;
    for (const m of due) {
      // Isolate each monitor: one provider/mutation error must not abort the
      // rest of the sweep (an unattended cron should be resilient row-by-row).
      try {
        const result = await monitorProvider.check({
          type: m.type,
          title: m.title,
          url: m.url,
          conditions: (m.conditions ?? undefined) as MonitorConditions | undefined,
        });
        await ctx.runMutation(internal.scheduled.applyMonitorCheck, {
          monitorId: m._id,
          result,
        });
        checked++;
      } catch (err) {
        failed++;
        console.error(`monitor check failed for ${m._id}:`, err);
      }
    }
    return { checked, failed };
  },
});

// --- Daily briefing ----------------------------------------------------------

/**
 * Proactive morning briefing. Runs every 30 minutes; for each user who opted in
 * (Settings), when their LOCAL clock reaches their chosen hour we send one in-app
 * notification per workspace summarizing today: tasks due, reminders, events, and
 * pending approvals. Deduped per local day via `lastBriefingSentAt`.
 */
export const sendDailyBriefings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const users = await ctx.db.query("users").collect();
    let sent = 0;

    for (const user of users) {
     // Isolate each user so one bad row doesn't abort briefings for everyone.
     try {
      if (!user.briefingEnabled) continue;
      const tz = user.timezone ?? "UTC";
      const targetHour = user.briefingHour ?? 8;
      if (currentHourInTz(tz) !== targetHour) continue;

      const { dayStartMs, dayEndMs } = todayWindowInTz(tz);
      // Already briefed today (in the user's local day)? Skip.
      if (user.lastBriefingSentAt && user.lastBriefingSentAt >= dayStartMs) {
        continue;
      }

      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", user.clerkUserId))
        .collect();
      if (memberships.length === 0) continue;

      let anySent = false;
      for (const m of memberships) {
        const [tasks, events, approvals, reminders] = [
          await ctx.db
            .query("tasks")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", m.workspaceId))
            .collect(),
          await ctx.db
            .query("calendarEvents")
            .withIndex("by_workspace_start", (q) =>
              q
                .eq("workspaceId", m.workspaceId)
                .gte("startAt", dayStartMs)
                .lte("startAt", dayEndMs),
            )
            .collect(),
          await ctx.db
            .query("approvalRequests")
            .withIndex("by_workspace_status", (q) =>
              q.eq("workspaceId", m.workspaceId).eq("status", "pending"),
            )
            .collect(),
          await ctx.db
            .query("reminders")
            .withIndex("by_workspace_status", (q) =>
              q.eq("workspaceId", m.workspaceId).eq("status", "scheduled"),
            )
            .collect(),
        ];
        const tasksToday = tasks.filter(
          (t) =>
            t.status !== "done" &&
            t.status !== "cancelled" &&
            t.dueAt !== undefined &&
            t.dueAt >= dayStartMs &&
            t.dueAt <= dayEndMs,
        ).length;
        const remindersToday = reminders.filter(
          (r) => r.remindAt >= dayStartMs && r.remindAt <= dayEndMs,
        ).length;
        const eventsToday = events.length;
        const pendingApprovals = approvals.length;

        if (
          tasksToday + remindersToday + eventsToday + pendingApprovals ===
          0
        ) {
          continue; // nothing to report for this workspace
        }
        const parts: string[] = [];
        if (tasksToday) parts.push(`${tasksToday} task${tasksToday > 1 ? "s" : ""} due`);
        if (eventsToday) parts.push(`${eventsToday} event${eventsToday > 1 ? "s" : ""}`);
        if (remindersToday) parts.push(`${remindersToday} reminder${remindersToday > 1 ? "s" : ""}`);
        if (pendingApprovals) parts.push(`${pendingApprovals} approval${pendingApprovals > 1 ? "s" : ""} waiting`);
        await notify(ctx, {
          workspaceId: m.workspaceId,
          userId: user.clerkUserId,
          title: "Your day at a glance",
          message: parts.join(" · "),
          type: "daily_briefing",
          href: "/dashboard",
        });
        anySent = true;
      }

      if (!anySent) {
        // Everything is clear — still say good morning once, in the first workspace.
        await notify(ctx, {
          workspaceId: memberships[0].workspaceId,
          userId: user.clerkUserId,
          title: "Your day at a glance",
          message: "All clear today — nothing due, no approvals waiting.",
          type: "daily_briefing",
          href: "/dashboard",
        });
      }
      await ctx.db.patch(user._id, { lastBriefingSentAt: now });
      sent++;
     } catch (err) {
       console.error(`daily briefing failed for ${user.clerkUserId}:`, err);
     }
    }
    return { sent };
  },
});
