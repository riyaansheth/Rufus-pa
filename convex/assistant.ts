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
import { toMs, todayWindowInTz } from "./lib/time";
import {
  buildDeepLink,
  bookMyShowCityUrl,
  bmsShowtimesUrl,
  isBookMyShowEventUrl,
  isBookMyShowUrl,
  applyAffiliate,
} from "./lib/deepLinks";

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

You can also MANAGE existing items by name via the manage* tools: complete/reopen/cancel/delete/update tasks, cancel/reschedule reminders, edit calendar events (change their title, time, location, or description — use manageCalendarEvent with action "update" and only the fields that change; or reschedule/rename/delete), and pause/resume/delete monitors. Users refer to items loosely ("mark the vendor call as done") — pass their words as titleQuery. If the tool returns candidates, ask the user which one they meant; never guess between multiple matches. You cannot approve or reject approval requests — a human must decide those on the Approvals page; offer to point them there.

MEMORY: You remember the user across conversations. Their profile (name, location, role) and remembered facts are provided to you each turn — use them and NEVER ask again for something you already know (e.g. don't ask where they live if their location is given). When the user shares a durable personal fact (where they live, a preference, their role, family, recurring context), call rememberFact to store it. If they tell you a profile detail changed ("I moved to Delhi", "I'm a PM now"), call updateProfile to correct it. Don't remember trivial one-off task details — only lasting facts.

REAL-TIME KNOWLEDGE: You have LIVE web access via the webSearch tool. You are not limited to training data. Whenever a question depends on current, recent, or real-world facts — news, prices, weather, sports scores, stock/crypto quotes, product availability, schedules, "who/what/when is…", flight/travel info, anything that could have changed after your training cut-off, or anything you're not fully certain about — call webSearch FIRST and answer from the fresh results. Prefer searching over guessing. You can answer questions on ANY topic in the world this way. When you use search results, weave in the key facts and, when helpful, mention the source. Do not claim you lack internet access or real-time data — you have both.

CRITICAL: For anything about what is CURRENT/happening NOW — movies now showing or in cinemas, this week's releases, latest news, today's weather, current prices, live scores, what's trending, what's available — you MUST call a live tool first and answer ONLY from those results. NEVER list current movies, showtimes, news, prices, or "what's out now" from memory: your training data is stale and will be wrong.
- For MOVIES currently in cinemas/theatres, use the nowPlayingMovies tool (real TMDB data). Present the titles cleanly and offer to open BookMyShow for whichever they pick.
- For everything else current, use webSearch.
If you're about to answer a "now/currently/latest/today" question without having called a tool, stop and call one first.

CRITICAL SAFETY RULES — never violate these:
- You are a SUPERVISED assistant, not an auto-purchase bot.
- You NEVER complete a payment, checkout, booking, or enter/read an OTP, UPI PIN, CVV, or password. If asked, explain that the human must complete the final payment/OTP/booking step themselves.
- For anything involving money, purchases, or third-party bookings (Amazon, BookMyShow, etc.), you create an APPROVAL REQUEST via the createPurchaseRequest tool and/or a monitor — you never claim you bought or booked anything.
- Never claim an action succeeded unless a tool call actually returned success.
- Only ask for missing details when genuinely required; otherwise pick sensible defaults and proceed.

BOOK NOW vs TRACK LATER: If the user wants to book/buy something RIGHT NOW (urgency words like "now", "book it", "right now", "immediately", "open it", "let's book"), call openBookingLink to open the provider page immediately — do NOT create a monitor for that. When they name a day ("tomorrow", "Friday"), also pass date as YYYY-MM-DD (resolved in their timezone) so the link opens that day's showtimes directly. Only create a monitor (createAvailabilityMonitor) when they want to be ALERTED later or when bookings aren't open yet. Opening the page is fine; you still never select seats or complete payment/OTP — say so briefly.

For movie/event ticket requests:
- Always pass the BARE film/event name as searchQuery (e.g. "Obsession"), separate from the verbose title — this builds a booking deep link that opens the exact movie for the user's city (not just the provider's homepage). Include the user's city when mentioned (or ask once).
- RECOMMENDED SEATS: use the webSearch tool to look up the best/recommended seats for that specific cinema (e.g. "best seats at PVR Marine Lines Mumbai" or general guidance for that screen), and put a short recommendation in the monitor's note and the approval description (e.g. "Recommended: rows H–K, center block"). You are only ADVISING which seats to pick — you never select seats or complete booking. The human chooses seats and pays on the provider's site.
- A booking deep link is generated automatically so they land one tap from seat selection when bookings open.

When a request maps to a tool, call it. After acting, briefly confirm what you did and the clear next step. Example phrases:
- "I created a calendar event for tomorrow at 5:00 PM."
- "I created a monitor. If the condition is met, I'll create a purchase request for approval. I won't complete payment or OTP steps."
- "Bookings tracking is set. When bookings open, I'll notify you and prepare an approval request. Final booking and payment must be completed by you."

Time handling: interpret relative times against the provided current time and express any date/time arguments as ISO 8601 strings (e.g. 2026-07-02T17:00:00). Assume 1-hour duration for meetings unless told otherwise.

Style: your replies may be read aloud by text-to-speech. Lead with ONE short spoken-friendly confirmation sentence (no markdown, no lists in that first sentence). Add details after it only when genuinely useful.`;

// Timezone parsing/window helpers live in lib/time.ts (shared with the briefing cron).

// --- Tool schemas (surfaced to OpenAI) ------------------------------------

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "webSearch",
      description:
        "Search the live web for current, real-time, or real-world information on ANY topic (news, prices, weather, sports, stocks/crypto, schedules, facts, people, products, travel, etc.). Use this whenever an answer depends on up-to-date or post-training-cutoff information, or when you are unsure. Returns a synthesized answer with sources.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "A focused natural-language search query capturing what to find out.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rememberFact",
      description:
        "Store a durable personal fact about the user (where they live, a preference, their role, family, recurring context) so you never ask again. Use for lasting facts only, not one-off task details.",
      parameters: {
        type: "object",
        properties: {
          fact: {
            type: "string",
            description: "The fact to remember, in a concise sentence.",
          },
        },
        required: ["fact"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "updateProfile",
      description:
        "Update the user's stored profile when they tell you a detail changed (moved city, changed role, wants to be called something else). Only include the fields that change.",
      parameters: {
        type: "object",
        properties: {
          displayName: { type: "string" },
          city: { type: "string" },
          country: { type: "string" },
          jobTitle: { type: "string", description: "Role / occupation" },
          about: { type: "string" },
        },
      },
    },
  },
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
        "Track a product/movie/event/URL and alert when a condition is met. Does not scrape or purchase. If no URL is given, a booking/product deep link is generated automatically.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["product", "movie_ticket", "event", "generic_url"],
          },
          title: { type: "string" },
          searchQuery: {
            type: "string",
            description:
              "The BARE movie/product/event name to search for on the provider (e.g. just 'Obsession'), WITHOUT dates, seat counts, or venue text. Used to build the booking deep link.",
          },
          url: { type: "string" },
          city: { type: "string", description: "User's city (for ticket bookings)" },
          priceBelow: { type: "number", description: "Alert when price drops below this" },
          currency: { type: "string" },
          note: {
            type: "string",
            description:
              "Any extra context, e.g. recommended/best seats you found for this cinema (from webSearch).",
          },
        },
        required: ["type", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "nowPlayingMovies",
      description:
        "Get the movies CURRENTLY in cinemas/theatres right now — real live data (TMDB, region India by default). ALWAYS use this for 'what's showing now', 'movies in cinema', 'latest releases in theatres', etc. Never answer those from memory or generic web search.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "openBookingLink",
      description:
        "IMMEDIATELY open the booking/product page in the user's browser when they want to book or buy something RIGHT NOW (urgency keywords: 'now', 'book it', 'right now', 'immediately', 'open it', 'let's go'). This only OPENS the provider page — the human still selects seats and completes payment/OTP; you never checkout. Use createAvailabilityMonitor instead when they want to be alerted LATER, not open it now.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["product", "movie_ticket", "event", "generic_url"],
          },
          searchQuery: {
            type: "string",
            description:
              "The bare movie/product/event name to open (e.g. 'Obsession'), without dates/seats/venue text.",
          },
          city: { type: "string", description: "User's city (for ticket bookings)" },
          date: {
            type: "string",
            description:
              "Show date as YYYY-MM-DD (resolve 'tomorrow'/'Friday' in the user's timezone). Opens that day's showtimes directly.",
          },
          url: { type: "string", description: "An explicit URL, if the user gave one (wins)." },
        },
        required: ["type", "searchQuery"],
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
  {
    type: "function",
    function: {
      name: "listUpcomingEvents",
      description: "List upcoming calendar events.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "manageTask",
      description:
        "Complete, reopen, cancel, delete, or update an existing task found by (partial) title. If several tasks match, the result lists candidates — ask the user which one.",
      parameters: {
        type: "object",
        properties: {
          titleQuery: { type: "string", description: "Part of the task title" },
          action: {
            type: "string",
            enum: ["complete", "reopen", "cancel", "delete", "update"],
          },
          dueAt: { type: "string", description: "ISO 8601 (for update)" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["titleQuery", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "manageReminder",
      description:
        "Cancel or reschedule an existing reminder found by (partial) title.",
      parameters: {
        type: "object",
        properties: {
          titleQuery: { type: "string" },
          action: { type: "string", enum: ["cancel", "reschedule"] },
          remindAt: {
            type: "string",
            description: "ISO 8601 new time (required for reschedule)",
          },
        },
        required: ["titleQuery", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "manageCalendarEvent",
      description:
        "Edit or remove an existing calendar event found by (partial) title. Use action 'update' to change ANY combination of title, time, location, and/or description in one call (only include the fields that change). 'reschedule' changes only the time, 'rename' only the title, 'delete' removes it. Changes propagate to the mirrored Google Calendar event automatically when Google is connected.",
      parameters: {
        type: "object",
        properties: {
          titleQuery: { type: "string" },
          action: {
            type: "string",
            enum: ["update", "delete", "reschedule", "rename"],
          },
          startAt: { type: "string", description: "ISO 8601 new start" },
          endAt: { type: "string", description: "ISO 8601 new end (optional; defaults to keeping the event's current duration)" },
          newTitle: { type: "string", description: "New event title" },
          location: { type: "string", description: "New location" },
          description: { type: "string", description: "New description/notes" },
        },
        required: ["titleQuery", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "manageMonitor",
      description:
        "Pause, resume, or delete an existing availability monitor found by (partial) title.",
      parameters: {
        type: "object",
        properties: {
          titleQuery: { type: "string" },
          action: { type: "string", enum: ["pause", "resume", "delete"] },
        },
        required: ["titleQuery", "action"],
      },
    },
  },
];

type ActionDescriptor = {
  kind: string;
  label: string;
  entityType?: string;
  entityId?: string;
  href?: string;
  // When true, the client should immediately open `href` (e.g. a "book now"
  // request). Opening a page is NOT completing checkout — the human still
  // selects seats and pays.
  autoOpen?: boolean;
};

// Zod validation for each tool's arguments (defense against malformed model output).
const schemas = {
  webSearch: z.object({
    query: z.string().min(1),
  }),
  rememberFact: z.object({
    fact: z.string().min(1),
  }),
  updateProfile: z.object({
    displayName: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    jobTitle: z.string().optional(),
    about: z.string().optional(),
  }),
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
    searchQuery: z.string().optional(),
    url: z.string().optional(),
    city: z.string().optional(),
    priceBelow: z.number().optional(),
    currency: z.string().optional(),
    note: z.string().optional(),
  }),
  openBookingLink: z.object({
    type: z.enum(["product", "movie_ticket", "event", "generic_url"]),
    searchQuery: z.string().min(1),
    city: z.string().optional(),
    date: z.string().optional(),
    url: z.string().optional(),
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
  manageTask: z.object({
    titleQuery: z.string().min(1),
    action: z.enum(["complete", "reopen", "cancel", "delete", "update"]),
    dueAt: z.string().optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
  }),
  manageReminder: z.object({
    titleQuery: z.string().min(1),
    action: z.enum(["cancel", "reschedule"]),
    remindAt: z.string().optional(),
  }),
  manageCalendarEvent: z.object({
    titleQuery: z.string().min(1),
    action: z.enum(["update", "delete", "reschedule", "rename"]),
    startAt: z.string().optional(),
    endAt: z.string().optional(),
    newTitle: z.string().optional(),
    location: z.string().optional(),
    description: z.string().optional(),
  }),
  manageMonitor: z.object({
    titleQuery: z.string().min(1),
    action: z.enum(["pause", "resume", "delete"]),
  }),
};

/**
 * Find one record by (partial) title. Exact match wins; otherwise case-insensitive
 * substring. Exactly one hit → act on it. Zero or several → return them so the model
 * can ask the user to disambiguate instead of guessing.
 */
function resolveByTitle<T extends { title: string }>(
  rows: T[],
  query: string,
): { match: T } | { candidates: T[] } {
  const q = query.trim().toLowerCase();
  const exact = rows.filter((r) => r.title.trim().toLowerCase() === q);
  if (exact.length === 1) return { match: exact[0] };
  const partial = rows.filter((r) => r.title.toLowerCase().includes(q));
  if (partial.length === 1) return { match: partial[0] };
  return { candidates: partial.slice(0, 8) };
}

/** Uniform "couldn't resolve" tool output the model can act on. */
function ambiguousOutput(kind: string, query: string, candidates: { title: string }[]) {
  if (candidates.length === 0) {
    return { error: `No ${kind} found matching "${query}".` };
  }
  return {
    error: `Multiple ${kind}s match "${query}" — ask the user which one.`,
    candidates: candidates.map((c) => c.title),
  };
}

/**
 * Live web search via OpenAI's hosted web-search tool (Responses API). Gives the
 * assistant real-time, up-to-date knowledge on any topic without a third-party
 * search provider — it reuses the same OPENAI_API_KEY. Returns a synthesized
 * answer plus the source URLs the model cited.
 */
async function runWebSearch(
  query: string,
): Promise<{ answer: string; sources: { title?: string; url: string }[]; error?: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { answer: "", sources: [], error: "Web search not configured." };
  const model = process.env.OPENAI_SEARCH_MODEL || "gpt-4o-mini";
  // web_search_preview is the widely-available hosted tool for the gpt-4o family;
  // override via OPENAI_WEB_SEARCH_TOOL if your account exposes a different name.
  const toolType = process.env.OPENAI_WEB_SEARCH_TOOL || "web_search_preview";
  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
      model,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: toolType } as any],
      input: query,
    });
    const answer = (response.output_text ?? "").trim();
    // Collect any url_citation annotations the model attached to its answer.
    const sources: { title?: string; url: string }[] = [];
    const seen = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of ((response as any).output ?? []) as any[]) {
      for (const content of (item?.content ?? []) as any[]) {
        for (const ann of (content?.annotations ?? []) as any[]) {
          if (ann?.type === "url_citation" && ann.url && !seen.has(ann.url)) {
            seen.add(ann.url);
            sources.push({ title: ann.title, url: ann.url });
          }
        }
      }
    }
    if (!answer && sources.length === 0) {
      return { answer: "", sources: [], error: "No results found." };
    }
    return { answer, sources };
  } catch (err) {
    return {
      answer: "",
      sources: [],
      error: err instanceof Error ? err.message : "Web search failed.",
    };
  }
}

/**
 * Should this message be forced to hit the live web? True for informational
 * questions about current/real-world facts (movies now showing, news, weather,
 * prices, scores…). We force webSearch on these because GPT-5 at minimal
 * reasoning otherwise answers from stale training data. Excludes action commands
 * ("book/create/remind…"), which are not lookups.
 */
function needsRealtime(text: string): boolean {
  const t = text.toLowerCase();
  const isAction =
    /\b(create|add|remind|schedule|book|track|monitor|delete|cancel|move|reschedule|rename|mark|complete|set up|make (a|an|me a))\b/.test(
      t,
    );
  if (isAction) return false;
  const isQuestion =
    /\?/.test(t) ||
    /\b(what|which|who|whom|when|where|how|is|are|was|were|does|do|did|any|show me|tell me|list|find|recommend|suggest)\b/.test(
      t,
    );
  const current =
    /\b(now|rn|right now|currently|today|tonight|latest|current|recent|these days|at the moment|nowadays)\b/.test(
      t,
    ) || /\bthis (week|weekend|month|year|evening)\b/.test(t);
  const realworld =
    /\b(movie|movies|cinema|cinemas|theatre|theater|showing|playing|release|released|releasing|news|headline|weather|forecast|price|prices|cost|stock|crypto|score|scores|match|fixture|trending|showtime|showtimes|box office|winner|won|happening|events?)\b/.test(
      t,
    );
  return isQuestion && (current || realworld);
}

/**
 * Is this a "what movies are in cinemas now?" question? If so we force the
 * nowPlayingMovies (TMDB) tool for accurate live data. Excludes booking/action
 * commands ("book …", "remind …").
 */
function isMovieNowQuery(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(book|remind|track|monitor|create|schedule)\b/.test(t)) return false;
  const cinema =
    /\b(movie|movies|cinema|cinemas|film|films)\b/.test(t) &&
    /\b(showing|cinema|cinemas|theat(er|re)s?|playing|out|release|released|watch|see|good|recommend|any|what)\b/.test(
      t,
    );
  return cinema;
}

/**
 * Server-side "does the user want this booked/opened RIGHT NOW?" check — mirrors
 * the client heuristic. Used to auto-open a booking URL even when the model chose
 * a different tool than openBookingLink.
 */
function isBookNowIntent(text: string): boolean {
  const t = text.toLowerCase();
  const action =
    /\b(book|buy|purchase|reserve|ticket|tickets|catch|watch|see)\b/.test(t);
  const soon =
    /\b(now|right now|immediately|asap|tonight|today|tomorrow)\b/.test(t) ||
    /\bthis (evening|afternoon|morning|weekend|friday|saturday|sunday)\b/.test(t) ||
    /\b(book|open|buy) it\b/.test(t) ||
    /\blet'?s (go|book|buy)\b/.test(t);
  return action && soon;
}

/**
 * Resolve the best URL to OPEN for a booking request. For movies/events, use live
 * web search to find the SPECIFIC BookMyShow movie page (which needs BMS's internal
 * event id we can't scrape) and open that; fall back to BookMyShow's city listing
 * (never Google, never a bare homepage). An explicit user URL always wins.
 */
async function resolveBookingUrl(
  kind: "product" | "movie_ticket" | "event" | "generic_url",
  query: string,
  city?: string,
  explicitUrl?: string,
  isoDate?: string,
): Promise<string | undefined> {
  if (explicitUrl && explicitUrl.trim()) return applyAffiliate(explicitUrl.trim());
  if (kind === "movie_ticket" || kind === "event") {
    // Ask for the URL explicitly — the answer text often carries it even when
    // the citation list doesn't.
    const res = await runWebSearch(
      `Find the in.bookmyshow.com page for the ${
        kind === "movie_ticket" ? "movie" : "event"
      } "${query}"${city ? ` in ${city}` : ""}. Reply with the exact BookMyShow URL (it contains an ET code like ET00123456).`,
    );
    // Harvest candidates from BOTH the cited sources and any URLs in the answer.
    const candidates = [
      ...res.sources.map((s) => s.url),
      ...(res.answer.match(/https?:\/\/[^\s)\]}"'<>]+/g) ?? []),
    ].filter(isBookMyShowUrl);
    // The user's date (YYYY-MM-DD, already resolved in their tz by the model)
    // upgrades a movie page into that day's showtime picker.
    const yyyymmdd =
      isoDate && /^\d{4}-\d{2}-\d{2}/.test(isoDate)
        ? isoDate.slice(0, 10).replace(/-/g, "")
        : undefined;
    const specific = candidates.find(isBookMyShowEventUrl);
    if (specific) return applyAffiliate(bmsShowtimesUrl(specific, yyyymmdd));
    return applyAffiliate(candidates[0] ?? bookMyShowCityUrl(city));
  }
  return buildDeepLink({ kind, title: query, query, city, url: explicitUrl });
}

type NowPlayingMovie = {
  title: string;
  releaseDate?: string;
  language?: string;
  rating?: number;
  overview?: string;
};

/**
 * Movies CURRENTLY in theatres, from TMDB's official now_playing endpoint — real
 * live data (no scraping). Region defaults to India (TMDB_REGION). Requires
 * TMDB_API_KEY on the Convex deployment.
 */
async function fetchNowPlaying(): Promise<{
  movies?: NowPlayingMovie[];
  region?: string;
  error?: string;
}> {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    return {
      error:
        "Live movie listings aren't configured yet (TMDB_API_KEY missing on the deployment).",
    };
  }
  const region = process.env.TMDB_REGION || "IN";
  try {
    const url = `https://api.themoviedb.org/3/movie/now_playing?region=${region}&language=en-US&page=1&api_key=${encodeURIComponent(
      key,
    )}`;
    const res = await fetch(url);
    if (!res.ok) return { error: `TMDB error ${res.status}.` };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    const movies: NowPlayingMovie[] = results
      .sort((a, b) => (b?.popularity ?? 0) - (a?.popularity ?? 0))
      .slice(0, 12)
      .map((m) => ({
        title: String(m?.title ?? m?.original_title ?? "Untitled"),
        releaseDate: m?.release_date || undefined,
        language: m?.original_language || undefined,
        rating: typeof m?.vote_average === "number" ? m.vote_average : undefined,
        overview:
          typeof m?.overview === "string" && m.overview
            ? m.overview.slice(0, 160)
            : undefined,
      }));
    return { movies, region };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "TMDB fetch failed." };
  }
}

export const sendMessage = action({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.optional(v.id("assistantConversations")),
    content: v.string(),
    // IANA timezone from the browser (e.g. "Asia/Kolkata"). Used so relative times
    // ("tomorrow at 4pm") resolve in the USER's timezone, not the UTC server.
    timezone: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    conversationId: Id<"assistantConversations">;
    reply: string;
    openUrl?: string;
  }> => {
    const apiKey = process.env.OPENAI_API_KEY;
    // Verify workspace access (throws if not a member).
    await ctx.runQuery(api.memberships.myRole, { workspaceId: args.workspaceId });
    const me = await ctx.runQuery(api.users.me, {});
    const actorUserId = me?.clerkUserId;
    if (!actorUserId) throw new Error("Unauthenticated.");

    // Ensure conversation. A CLIENT-SUPPLIED conversationId is untrusted, so verify
    // it belongs to this workspace AND this user before using it (prevents reading or
    // writing another user's/workspace's conversation).
    let conversationId: Id<"assistantConversations">;
    if (args.conversationId) {
      await ctx.runQuery(internal.assistantData.assertConversationOwnership, {
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
        userId: actorUserId,
      });
      conversationId = args.conversationId;
    } else {
      conversationId = await ctx.runMutation(
        internal.assistantData.createConversation,
        {
          workspaceId: args.workspaceId,
          userId: actorUserId,
          title: args.content,
        },
      );
    }

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
    const tz = args.timezone || "UTC";
    // Current local time in the user's timezone, so the model reasons about
    // "today"/"tomorrow" correctly and emits offset-bearing ISO datetimes.
    let localNow = now.toISOString();
    try {
      localNow = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        dateStyle: "full",
        timeStyle: "long",
      }).format(now);
    } catch {
      // invalid tz → fall back to ISO/UTC
    }
    // What we already KNOW about the user (profile + remembered facts), so the
    // assistant never re-asks their name, city, role, etc.
    const memories: Array<{ content: string }> = await ctx.runQuery(
      api.memory.list,
      {},
    );
    const profileLines: string[] = [];
    if (me.displayName) profileLines.push(`Name: ${me.displayName}`);
    if (me.city)
      profileLines.push(
        `Location: ${me.city}${me.country ? `, ${me.country}` : ""}`,
      );
    if (me.jobTitle) profileLines.push(`Role: ${me.jobTitle}`);
    if (me.about) profileLines.push(`About: ${me.about}`);
    const memoryLines = memories.map((m) => `- ${m.content}`);
    const knownBlock =
      profileLines.length || memoryLines.length
        ? `\n\nWHAT YOU ALREADY KNOW ABOUT THIS USER — use it and do NOT ask for it again:\n${profileLines.join(
            "\n",
          )}${
            memoryLines.length
              ? `\nRemembered facts:\n${memoryLines.join("\n")}`
              : ""
          }`
        : "";

    const messages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}\n\nThe user's timezone is ${tz}. The current local time for the user is ${localNow}. Interpret all relative times (e.g. "tomorrow at 4pm", "Friday morning") in the user's timezone, and output every date/time argument as an ISO 8601 string that INCLUDES the timezone offset (e.g. 2026-07-06T16:00:00+05:30). Never output a datetime without an offset.${knownBlock}`,
      },
      ...history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
    ];

    const openai = new OpenAI({ apiKey });
    const model = process.env.OPENAI_ASSISTANT_MODEL || "gpt-5";
    const isGpt5 = /^gpt-5/.test(model);
    // GPT-5 / reasoning models (o-series) only accept the default temperature (1);
    // sending a custom value 400s. Older chat models keep the low-variance setting.
    const isReasoningModel = isGpt5 || /^o\d/.test(model);
    // SPEED: GPT-5 defaults to heavy "thinking" before every reply, which is far
    // too slow for a quick scheduling assistant. Run it at MINIMAL reasoning effort
    // and LOW verbosity so it answers fast while staying GPT-5. Dial up with
    // OPENAI_REASONING_EFFORT (minimal|low|medium|high) if you want deeper reasoning.
    // Note: "minimal" is GPT-5-only; the o-series floor is "low", and `verbosity`
    // is a GPT-5-only param — sending either to the o-series would 400.
    const reasoningEffort =
      process.env.OPENAI_REASONING_EFFORT || (isGpt5 ? "minimal" : "low");
    const modelParams: Record<string, unknown> = isReasoningModel
      ? {
          reasoning_effort:
            !isGpt5 && reasoningEffort === "minimal" ? "low" : reasoningEffort,
          ...(isGpt5 ? { verbosity: "low" } : {}),
        }
      : { temperature: 0.2 };
    const collectedActions: ActionDescriptor[] = [];
    // Booking URLs produced this turn by ANY tool (open/monitor), so an urgent
    // "book now" opens the page even if the model reached for a different tool.
    const collectedBookingUrls: string[] = [];

    // Force a live tool on the FIRST turn for "what's current" questions, so
    // answers can't come from stale training data. Movies-in-cinema → TMDB;
    // other current/real-world questions → web search.
    const forcedFirstTool = isMovieNowQuery(args.content)
      ? "nowPlayingMovies"
      : needsRealtime(args.content)
        ? "webSearch"
        : null;

    let reply = "";
    // Bounded tool loop.
    for (let iteration = 0; iteration < 6; iteration++) {
      const toolChoice =
        iteration === 0 && forcedFirstTool
          ? { type: "function" as const, function: { name: forcedFirstTool } }
          : "auto";
      let completion;
      try {
        completion = await openai.chat.completions.create({
          model,
          messages,
          tools,
          tool_choice: toolChoice,
          ...modelParams,
        } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
      } catch (err) {
        // Never hard-fail the whole turn on a model/API error (bad param, rate
        // limit, missing model entitlement, transient network). Persist a
        // friendly reply so the user gets feedback and the conversation stays
        // consistent (their message was already saved).
        console.error("assistant model call failed:", err);
        reply =
          "Sorry — I hit a problem reaching the assistant service just now. Please try again in a moment.";
        break;
      }
      const choice = completion.choices[0]?.message;
      if (!choice) break;

      if (choice.tool_calls && choice.tool_calls.length > 0) {
        messages.push({
          role: "assistant",
          content: choice.content ?? "",
          tool_calls: choice.tool_calls,
        });
        for (const call of choice.tool_calls) {
          // OpenAI requires EXACTLY one tool result per tool_call id. Even for an
          // unsupported (non-function) call we must emit a result, or the next
          // request 400s with a dangling tool_call_id.
          if (call.type !== "function") {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ error: "Unsupported tool call type." }),
            });
            continue;
          }
          const { output, action, bookingUrl } = await dispatchTool(
            ctx,
            args.workspaceId,
            tz,
            call.function.name,
            call.function.arguments,
          );
          if (action) collectedActions.push(action);
          if (bookingUrl) collectedBookingUrls.push(bookingUrl);
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

    // If the loop exhausted its tool budget without the model ever writing a
    // final answer, force one no-tools completion so the user gets a real reply
    // (e.g. a multi-search question) instead of a misleading canned message.
    if (!reply) {
      try {
        const finalCompletion = await openai.chat.completions.create({
          model,
          messages,
          tool_choice: "none",
          ...modelParams,
        } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
        reply = finalCompletion.choices[0]?.message?.content ?? "";
      } catch (err) {
        console.error("assistant final-summary call failed:", err);
      }
    }

    if (!reply) {
      reply =
        "I ran out of steps before I could finish that. Please try rephrasing, or check the relevant page.";
    }

    await ctx.runMutation(internal.assistantData.addMessage, {
      workspaceId: args.workspaceId,
      conversationId,
      role: "assistant",
      content: reply,
      actions: collectedActions.length ? collectedActions : undefined,
    });

    // Decide whether to auto-open a booking page. Priority: an explicit autoOpen
    // action (openBookingLink). Fallback: if the USER's message was an urgent
    // "book now" and ANY tool produced a booking URL this turn, open it too — so
    // it works even when the model reached for createAvailabilityMonitor instead.
    const openUrl =
      collectedActions.find((a) => a.autoOpen && a.href)?.href ??
      (isBookNowIntent(args.content) ? collectedBookingUrls[0] : undefined);

    return { conversationId, reply, openUrl };
  },
});

/**
 * Dispatch a single model tool call to a workspace-guarded Convex function.
 * Returns the tool output (fed back to the model) plus an optional UI action card.
 */
async function dispatchTool(
  ctx: ActionCtx,
  workspaceId: Id<"workspaces">,
  tz: string,
  name: string,
  rawArgs: string,
): Promise<{
  output: unknown;
  action?: ActionDescriptor;
  bookingUrl?: string;
}> {
  let parsed: unknown = {};
  try {
    parsed = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { output: { error: "Invalid tool arguments (not JSON)." } };
  }

  try {
    switch (name) {
      case "nowPlayingMovies": {
        return { output: await fetchNowPlaying() };
      }
      case "webSearch": {
        const a = schemas.webSearch.parse(parsed);
        const result = await runWebSearch(a.query);
        if (result.error) {
          // Don't let the model invent a "current" answer when the live lookup
          // failed — instruct it to be honest about the failure.
          return {
            output: {
              error: result.error,
              note: "Live web search failed. Tell the user you couldn't verify current information right now — do NOT fabricate an answer.",
            },
          };
        }
        return { output: result };
      }
      case "rememberFact": {
        const a = schemas.rememberFact.parse(parsed);
        await ctx.runMutation(api.memory.add, {
          content: a.fact,
          workspaceId,
        });
        return { output: { ok: true, remembered: a.fact } };
      }
      case "updateProfile": {
        const a = schemas.updateProfile.parse(parsed);
        if (
          a.displayName === undefined &&
          a.city === undefined &&
          a.country === undefined &&
          a.jobTitle === undefined &&
          a.about === undefined
        ) {
          return { output: { error: "No profile fields to update." } };
        }
        await ctx.runMutation(api.users.patchProfile, a);
        return { output: { ok: true, updated: a } };
      }
      case "createTask": {
        const a = schemas.createTask.parse(parsed);
        const id = await ctx.runMutation(api.tasks.create, {
          workspaceId,
          title: a.title,
          description: a.description,
          priority: a.priority,
          dueAt: toMs(a.dueAt, tz),
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
        const remindAt = toMs(a.remindAt, tz);
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
        const startAt = toMs(a.startAt, tz);
        if (!startAt) return { output: { error: "Could not parse startAt time." } };
        const endAt = toMs(a.endAt, tz) ?? startAt + 60 * 60 * 1000;
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
        // Prepare the flow: land the human as close to booking as a link can —
        // for movies/events this resolves the ACTUAL BookMyShow page via search.
        const url = await resolveBookingUrl(
          a.type,
          a.searchQuery ?? a.title,
          a.city,
          a.url,
        );
        const conditions: Record<string, unknown> = {};
        if (a.priceBelow !== undefined) {
          conditions.priceBelow = a.priceBelow;
          conditions.currency = a.currency ?? "INR";
        }
        if (a.city) conditions.city = a.city;
        if (a.note) conditions.note = a.note;
        const id = await ctx.runMutation(api.monitors.create, {
          workspaceId,
          type: a.type,
          title: a.title,
          url,
          conditions: Object.keys(conditions).length ? conditions : undefined,
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
          // If the user actually wanted it NOW, this URL gets auto-opened.
          bookingUrl: url ?? undefined,
        };
      }
      case "openBookingLink": {
        const a = schemas.openBookingLink.parse(parsed);
        // Find the actual BookMyShow movie page via web search; with a date it
        // deep-links straight to that day's showtime picker.
        const url = await resolveBookingUrl(
          a.type,
          a.searchQuery,
          a.city,
          a.url,
          a.date,
        );
        if (!url) return { output: { error: "Could not build a booking link." } };
        return {
          output: {
            ok: true,
            url,
            note: "Opening the BookMyShow page for this now. You choose the showtime, seats, and complete payment/OTP yourself — I never check out for you.",
          },
          action: {
            kind: "open_booking",
            label: `Open on BookMyShow: ${a.searchQuery}`,
            href: url,
            autoOpen: true,
          },
          bookingUrl: url,
        };
      }
      case "createPurchaseRequest": {
        const a = schemas.createPurchaseRequest.parse(parsed);
        const kind = a.kind ?? "purchase_request";
        // Attach a deep link so the approver lands one tap from checkout.
        const url = buildDeepLink({
          kind: kind === "ticket_booking_request" ? "movie_ticket" : "product",
          title: a.title,
          url: a.url,
        });
        const id = await ctx.runMutation(api.approvals.create, {
          workspaceId,
          type: kind,
          title: a.title,
          description:
            a.description ??
            "Prepared by the assistant. Requires human approval before any checkout. The assistant will not complete payment, OTP, or booking.",
          payload: url ? { url } : undefined,
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
        const { dayStartMs, dayEndMs } = todayWindowInTz(tz);
        const [tasks, reminders, events] = await Promise.all([
          ctx.runQuery(api.tasks.listDueToday, {
            workspaceId,
            dayStartMs,
            dayEndMs,
          }),
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
      case "listUpcomingEvents": {
        const rows = await ctx.runQuery(api.calendar.listUpcoming, {
          workspaceId,
          limit: 20,
        });
        return { output: { events: rows } };
      }
      case "manageTask": {
        const a = schemas.manageTask.parse(parsed);
        const rows = await ctx.runQuery(api.tasks.list, { workspaceId });
        // Deleting/completing "done" tasks is legal; scope open tasks first for
        // friendlier matching, but fall back to all.
        const open = rows.filter(
          (t) => t.status !== "done" && t.status !== "cancelled",
        );
        let res = resolveByTitle(a.action === "reopen" ? rows : open, a.titleQuery);
        if (!("match" in res)) {
          const all = resolveByTitle(rows, a.titleQuery);
          if ("match" in all) res = all;
        }
        if (!("match" in res)) {
          return { output: ambiguousOutput("task", a.titleQuery, res.candidates) };
        }
        const task = res.match;
        if (a.action === "delete") {
          await ctx.runMutation(api.tasks.remove, { workspaceId, taskId: task._id });
        } else {
          const status =
            a.action === "complete"
              ? ("done" as const)
              : a.action === "reopen"
                ? ("todo" as const)
                : a.action === "cancel"
                  ? ("cancelled" as const)
                  : undefined;
          await ctx.runMutation(api.tasks.update, {
            workspaceId,
            taskId: task._id,
            status,
            priority: a.priority,
            dueAt: toMs(a.dueAt, tz),
          });
        }
        return {
          output: { ok: true, task: task.title, action: a.action },
          action: {
            kind: "task_updated",
            label: `Task ${a.action}d: ${task.title}`,
            entityType: "task",
            entityId: task._id,
            href: "/tasks",
          },
        };
      }
      case "manageReminder": {
        const a = schemas.manageReminder.parse(parsed);
        const rows = await ctx.runQuery(api.reminders.list, { workspaceId });
        const res = resolveByTitle(
          rows.filter((r) => r.status === "scheduled"),
          a.titleQuery,
        );
        if (!("match" in res)) {
          return {
            output: ambiguousOutput("reminder", a.titleQuery, res.candidates),
          };
        }
        const reminder = res.match;
        if (a.action === "cancel") {
          await ctx.runMutation(api.reminders.cancel, {
            workspaceId,
            reminderId: reminder._id,
          });
        } else {
          const remindAt = toMs(a.remindAt, tz);
          if (!remindAt) {
            return { output: { error: "Reschedule needs a valid remindAt time." } };
          }
          await ctx.runMutation(api.reminders.reschedule, {
            workspaceId,
            reminderId: reminder._id,
            remindAt,
          });
        }
        return {
          output: { ok: true, reminder: reminder.title, action: a.action },
          action: {
            kind: "reminder_updated",
            label: `Reminder ${a.action === "cancel" ? "cancelled" : "rescheduled"}: ${reminder.title}`,
            entityType: "reminder",
            entityId: reminder._id,
            href: "/reminders",
          },
        };
      }
      case "manageCalendarEvent": {
        const a = schemas.manageCalendarEvent.parse(parsed);
        const rows = await ctx.runQuery(api.calendar.listUpcoming, {
          workspaceId,
          limit: 50,
        });
        const res = resolveByTitle(rows, a.titleQuery);
        if (!("match" in res)) {
          return { output: ambiguousOutput("event", a.titleQuery, res.candidates) };
        }
        const event = res.match;
        if (a.action === "delete") {
          await ctx.runMutation(api.calendar.remove, {
            workspaceId,
            eventId: event._id,
          });
          return {
            output: {
              ok: true,
              event: event.title,
              action: "delete",
              note:
                event.source === "google"
                  ? "The mirrored Google Calendar event is being removed too."
                  : undefined,
            },
            action: {
              kind: "event_updated",
              label: `Event deleted: ${event.title}`,
              entityType: "calendarEvent",
              href: "/calendar",
            },
          };
        }
        const startAt = toMs(a.startAt, tz);
        if (a.action === "reschedule" && !startAt) {
          return { output: { error: "Reschedule needs a valid startAt time." } };
        }
        // Keep the event's current duration if a new start is given without a new end.
        const endAt =
          toMs(a.endAt, tz) ??
          (startAt ? startAt + (event.endAt - event.startAt) : undefined);
        // Which fields this action is allowed to change.
        const wantTitle = a.action === "rename" || a.action === "update";
        const wantTimes = a.action === "reschedule" || a.action === "update";
        const wantMeta = a.action === "update";
        const patch = {
          workspaceId,
          eventId: event._id,
          title: wantTitle ? a.newTitle : undefined,
          startAt: wantTimes ? startAt ?? undefined : undefined,
          endAt: wantTimes ? endAt ?? undefined : undefined,
          location: wantMeta ? a.location : undefined,
          description: wantMeta ? a.description : undefined,
        };
        if (
          patch.title === undefined &&
          patch.startAt === undefined &&
          patch.endAt === undefined &&
          patch.location === undefined &&
          patch.description === undefined
        ) {
          return {
            output: {
              error:
                "Nothing to change — specify a new title, time, location, or description.",
            },
          };
        }
        const result = await ctx.runMutation(api.calendar.updateInternal, patch);
        return {
          output: {
            ok: true,
            event: event.title,
            action: a.action,
            note: result.wasGoogleMirrored
              ? "The mirrored Google Calendar event is being updated too."
              : undefined,
          },
          action: {
            kind: "event_updated",
            label: `Event ${a.action}d: ${a.newTitle ?? event.title}`,
            entityType: "calendarEvent",
            entityId: event._id,
            href: "/calendar",
          },
        };
      }
      case "manageMonitor": {
        const a = schemas.manageMonitor.parse(parsed);
        const rows = await ctx.runQuery(api.monitors.list, { workspaceId });
        const res = resolveByTitle(rows, a.titleQuery);
        if (!("match" in res)) {
          return {
            output: ambiguousOutput("monitor", a.titleQuery, res.candidates),
          };
        }
        const monitor = res.match;
        if (a.action === "delete") {
          await ctx.runMutation(api.monitors.remove, {
            workspaceId,
            monitorId: monitor._id,
          });
        } else {
          await ctx.runMutation(api.monitors.setStatus, {
            workspaceId,
            monitorId: monitor._id,
            status: a.action === "pause" ? "paused" : "active",
          });
        }
        return {
          output: { ok: true, monitor: monitor.title, action: a.action },
          action: {
            kind: "monitor_updated",
            label: `Monitor ${a.action}d: ${monitor.title}`,
            entityType: "monitor",
            entityId: monitor._id,
            href: "/monitors",
          },
        };
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
