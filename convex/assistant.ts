import { v } from "convex/values";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { z } from "zod";
import { action, ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

/**
 * The AI assistant.
 *
 * SAFETY MODEL: the model never touches the database. It can only emit tool calls,
 * which this action dispatches to the SAME workspace-guarded Convex functions a human
 * uses (tasks.create, approvals.create, ...). Money/OTP/booking are never executed —
 * sensitive actions become approval REQUESTS. Every turn is audit-logged.
 */

const SYSTEM_PROMPT = `You are Rufuspa, a careful, professional AI executive assistant for a team workspace.

You can: schedule calendar events, create reminders, create and track tasks, set up availability monitors (for products, movie tickets, events, or URLs), prepare purchase/booking approval requests, and answer questions about the user's day.

CRITICAL SAFETY RULES — never violate these:
- You are a SUPERVISED assistant, not an auto-purchase bot.
- You NEVER complete a payment, checkout, booking, or enter/read an OTP, UPI PIN, CVV, or password. If asked, explain that the human must complete the final payment/OTP/booking step themselves.
- For anything involving money, purchases, or third-party bookings (Amazon, BookMyShow, etc.), you create an APPROVAL REQUEST via the createPurchaseRequest tool and/or a monitor — you never claim you bought or booked anything.
- Never claim an action succeeded unless a tool call actually returned success.
- Only ask for missing details when genuinely required; otherwise pick sensible defaults and proceed.

When a request maps to a tool, call it. After acting, briefly confirm what you did and the clear next step. Example phrases:
- "I created a calendar event for tomorrow at 5:00 PM."
- "I created a monitor. If the condition is met, I'll create a purchase request for approval. I won't complete payment or OTP steps."
- "Bookings tracking is set. When bookings open, I'll notify you and prepare an approval request. Final booking and payment must be completed by you."

Time handling: interpret relative times against the provided current time and express any date/time arguments as ISO 8601 strings (e.g. 2026-07-02T17:00:00). Assume 1-hour duration for meetings unless told otherwise.`;

function toMs(value?: string | number | null): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// --- Tool schemas (surfaced to OpenAI) ------------------------------------

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "createTask",
      description: "Create a task in the workspace.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          dueAt: { type: "string", description: "ISO 8601 datetime" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createReminder",
      description: "Create a reminder that notifies the user at a given time.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          message: { type: "string" },
          remindAt: { type: "string", description: "ISO 8601 datetime" },
        },
        required: ["title", "remindAt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createCalendarEvent",
      description:
        "Create a calendar event. Mirrors to Google Calendar if connected, else internal.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          startAt: { type: "string", description: "ISO 8601 datetime" },
          endAt: { type: "string", description: "ISO 8601 datetime (optional; defaults to +1h)" },
          location: { type: "string" },
          attendees: { type: "array", items: { type: "string" } },
        },
        required: ["title", "startAt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createAvailabilityMonitor",
      description:
        "Track a product/movie/event/URL and alert when a condition is met. Does not scrape or purchase.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["product", "movie_ticket", "event", "generic_url"],
          },
          title: { type: "string" },
          url: { type: "string" },
          priceBelow: { type: "number", description: "Alert when price drops below this" },
          currency: { type: "string" },
          note: { type: "string" },
        },
        required: ["type", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createPurchaseRequest",
      description:
        "Prepare a purchase or booking APPROVAL request for a human to approve. Never completes payment.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          amount: { type: "number" },
          currency: { type: "string" },
          url: { type: "string" },
          kind: {
            type: "string",
            enum: ["purchase_request", "ticket_booking_request"],
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listPendingApprovals",
      description: "List pending approval requests in the workspace.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "listTodaySchedule",
      description: "List today's tasks, upcoming reminders, and upcoming events.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "listTasks",
      description: "List tasks, optionally filtered by status.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["todo", "in_progress", "done", "cancelled"],
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listReminders",
      description: "List reminders in the workspace.",
      parameters: { type: "object", properties: {} },
    },
  },
];

type ActionDescriptor = {
  kind: string;
  label: string;
  entityType?: string;
  entityId?: string;
  href?: string;
};

// Zod validation for each tool's arguments (defense against malformed model output).
const schemas = {
  createTask: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    dueAt: z.string().optional(),
  }),
  createReminder: z.object({
    title: z.string().min(1),
    message: z.string().optional(),
    remindAt: z.string(),
  }),
  createCalendarEvent: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    startAt: z.string(),
    endAt: z.string().optional(),
    location: z.string().optional(),
    attendees: z.array(z.string()).optional(),
  }),
  createAvailabilityMonitor: z.object({
    type: z.enum(["product", "movie_ticket", "event", "generic_url"]),
    title: z.string().min(1),
    url: z.string().optional(),
    priceBelow: z.number().optional(),
    currency: z.string().optional(),
    note: z.string().optional(),
  }),
  createPurchaseRequest: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    url: z.string().optional(),
    kind: z
      .enum(["purchase_request", "ticket_booking_request"])
      .optional(),
  }),
};

export const sendMessage = action({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.optional(v.id("assistantConversations")),
    content: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ conversationId: Id<"assistantConversations">; reply: string }> => {
    const apiKey = process.env.OPENAI_API_KEY;
    // Verify workspace access (throws if not a member).
    await ctx.runQuery(api.memberships.myRole, { workspaceId: args.workspaceId });
    const me = await ctx.runQuery(api.users.me, {});
    const actorUserId = me?.clerkUserId;
    if (!actorUserId) throw new Error("Unauthenticated.");

    // Ensure conversation.
    const conversationId: Id<"assistantConversations"> =
      args.conversationId ??
      (await ctx.runMutation(internal.assistantData.createConversation, {
        workspaceId: args.workspaceId,
        userId: actorUserId,
        title: args.content,
      }));

    // Persist user message + audit the command.
    await ctx.runMutation(internal.assistantData.addMessage, {
      workspaceId: args.workspaceId,
      conversationId,
      role: "user",
      content: args.content,
    });

    if (!apiKey) {
      const reply =
        "The assistant is not configured yet: OPENAI_API_KEY is missing on the Convex deployment. Set it with `npx convex env set OPENAI_API_KEY sk-...` and try again.";
      await ctx.runMutation(internal.assistantData.addMessage, {
        workspaceId: args.workspaceId,
        conversationId,
        role: "assistant",
        content: reply,
      });
      return { conversationId, reply };
    }

    // Build model context from stored history (user/assistant turns only).
    const history: Array<{ role: string; content: string }> =
      await ctx.runQuery(internal.assistantData.historyForModel, {
        conversationId,
      });
    const now = new Date();
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}\n\nCurrent time: ${now.toISOString()} (server time).`,
      },
      ...history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
    ];

    const openai = new OpenAI({ apiKey });
    const model = process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini";
    const collectedActions: ActionDescriptor[] = [];

    let reply = "";
    // Bounded tool loop.
    for (let iteration = 0; iteration < 6; iteration++) {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      });
      const choice = completion.choices[0]?.message;
      if (!choice) break;

      if (choice.tool_calls && choice.tool_calls.length > 0) {
        messages.push({
          role: "assistant",
          content: choice.content ?? "",
          tool_calls: choice.tool_calls,
        });
        for (const call of choice.tool_calls) {
          if (call.type !== "function") continue;
          const { output, action } = await dispatchTool(
            ctx,
            args.workspaceId,
            call.function.name,
            call.function.arguments,
          );
          if (action) collectedActions.push(action);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(output),
          });
        }
        continue; // let the model observe tool results
      }

      reply = choice.content ?? "";
      break;
    }

    if (!reply) {
      reply =
        "I've recorded that, but I couldn't produce a final summary. Please check the relevant page.";
    }

    await ctx.runMutation(internal.assistantData.addMessage, {
      workspaceId: args.workspaceId,
      conversationId,
      role: "assistant",
      content: reply,
      actions: collectedActions.length ? collectedActions : undefined,
    });

    return { conversationId, reply };
  },
});

/**
 * Dispatch a single model tool call to a workspace-guarded Convex function.
 * Returns the tool output (fed back to the model) plus an optional UI action card.
 */
async function dispatchTool(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  name: string,
  rawArgs: string,
): Promise<{ output: unknown; action?: ActionDescriptor }> {
  let parsed: unknown = {};
  try {
    parsed = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { output: { error: "Invalid tool arguments (not JSON)." } };
  }

  try {
    switch (name) {
      case "createTask": {
        const a = schemas.createTask.parse(parsed);
        const id = await ctx.runMutation(api.tasks.create, {
          workspaceId,
          title: a.title,
          description: a.description,
          priority: a.priority,
          dueAt: toMs(a.dueAt),
        });
        return {
          output: { ok: true, taskId: id },
          action: {
            kind: "task_created",
            label: `Task: ${a.title}`,
            entityType: "task",
            entityId: id,
            href: "/tasks",
          },
        };
      }
      case "createReminder": {
        const a = schemas.createReminder.parse(parsed);
        const remindAt = toMs(a.remindAt);
        if (!remindAt) return { output: { error: "Could not parse remindAt time." } };
        const id = await ctx.runMutation(api.reminders.create, {
          workspaceId,
          title: a.title,
          message: a.message,
          remindAt,
        });
        return {
          output: { ok: true, reminderId: id },
          action: {
            kind: "reminder_created",
            label: `Reminder: ${a.title}`,
            entityType: "reminder",
            entityId: id,
            href: "/reminders",
          },
        };
      }
      case "createCalendarEvent": {
        const a = schemas.createCalendarEvent.parse(parsed);
        const startAt = toMs(a.startAt);
        if (!startAt) return { output: { error: "Could not parse startAt time." } };
        const endAt = toMs(a.endAt) ?? startAt + 60 * 60 * 1000;
        const res = await ctx.runAction(api.calendar.createEvent, {
          workspaceId,
          title: a.title,
          description: a.description,
          startAt,
          endAt,
          location: a.location,
          attendees: a.attendees,
        });
        return {
          output: {
            ok: true,
            eventId: res.eventId,
            mirroredToGoogle: res.mirroredToGoogle,
          },
          action: {
            kind: "calendar_event_created",
            label: `Event: ${a.title}`,
            entityType: "calendarEvent",
            entityId: res.eventId,
            href: "/calendar",
          },
        };
      }
      case "createAvailabilityMonitor": {
        const a = schemas.createAvailabilityMonitor.parse(parsed);
        const conditions =
          a.priceBelow !== undefined
            ? { priceBelow: a.priceBelow, currency: a.currency ?? "INR" }
            : a.note
              ? { note: a.note }
              : undefined;
        const id = await ctx.runMutation(api.monitors.create, {
          workspaceId,
          type: a.type,
          title: a.title,
          url: a.url,
          conditions,
        });
        return {
          output: { ok: true, monitorId: id },
          action: {
            kind: "monitor_created",
            label: `Monitor: ${a.title}`,
            entityType: "monitor",
            entityId: id,
            href: "/monitors",
          },
        };
      }
      case "createPurchaseRequest": {
        const a = schemas.createPurchaseRequest.parse(parsed);
        const id = await ctx.runMutation(api.approvals.create, {
          workspaceId,
          type: a.kind ?? "purchase_request",
          title: a.title,
          description:
            a.description ??
            "Prepared by the assistant. Requires human approval before any checkout. The assistant will not complete payment, OTP, or booking.",
          payload: a.url ? { url: a.url } : undefined,
          amount: a.amount,
          currency: a.currency,
        });
        return {
          output: { ok: true, approvalId: id, note: "Approval required before checkout." },
          action: {
            kind: "approval_requested",
            label: `Approval: ${a.title}`,
            entityType: "approvalRequest",
            entityId: id,
            href: "/approvals",
          },
        };
      }
      case "listPendingApprovals": {
        const rows = await ctx.runQuery(api.approvals.listPending, { workspaceId });
        return { output: { approvals: rows } };
      }
      case "listTodaySchedule": {
        const [tasks, reminders, events] = await Promise.all([
          ctx.runQuery(api.tasks.listDueToday, { workspaceId }),
          ctx.runQuery(api.reminders.listUpcoming, { workspaceId, limit: 10 }),
          ctx.runQuery(api.calendar.listUpcoming, { workspaceId, limit: 10 }),
        ]);
        return { output: { tasks, reminders, events } };
      }
      case "listTasks": {
        const p = parsed as { status?: "todo" | "in_progress" | "done" | "cancelled" };
        const rows = await ctx.runQuery(api.tasks.list, {
          workspaceId,
          status: p.status,
        });
        return { output: { tasks: rows } };
      }
      case "listReminders": {
        const rows = await ctx.runQuery(api.reminders.list, { workspaceId });
        return { output: { reminders: rows } };
      }
      default:
        return { output: { error: `Unknown tool: ${name}` } };
    }
  } catch (err) {
    return {
      output: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}
