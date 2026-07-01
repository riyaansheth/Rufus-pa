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
    const due = await ctx.db
      .query("reminders")
      .withIndex("by_remindAt", (q) => q.lte("remindAt", now))
      .collect();
    let triggered = 0;
    for (const r of due) {
      if (r.status !== "scheduled") continue;
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
    for (const m of due) {
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
    }
    return { checked: due.length };
  },
});
