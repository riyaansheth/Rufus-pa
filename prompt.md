# prompt.md — Product & Build Specification

This is the specification Rufuspa was built to. It doubles as the product brief and the
acceptance criteria. See `architecture.md` for how it was implemented and `README.md` for
setup.

## Product

An **AI executive/personal assistant for employers, teams, and clients.** Users talk or type
to an assistant that can schedule calendar events, create reminders, manage tasks, monitor
products/events/movie bookings, prepare purchase requests, and **ask for human approval
before any sensitive or money-related action.**

**Positioning:** "AI executive assistant for teams that manages calendar, reminders, task
tracking, availability monitoring, and purchase-request preparation with human approval and
audit logs."

## The core product rule (supervised assistant)

This must be a **supervised** assistant, **not** an unsafe auto-purchase bot. It must never:

- read OTPs automatically, or enter OTPs automatically
- store UPI PIN, card CVV, or banking passwords
- bypass captcha, queues, or website security
- make hidden purchases without approval
- share credentials between users
- perform irreversible actions without user confirmation

For Amazon/BookMyShow/similar: the assistant may **monitor availability, track conditions,
alert the user, open/prepare the flow, and create an approval request.** It must **not**
silently complete checkout. The final payment/OTP/UPI/card approval is always done by the
human.

## Required stack (and constraints)

- Next.js (App Router) + TypeScript
- Convex for backend, database, realtime, scheduled functions, server actions
- Clerk for auth
- OpenAI for the assistant, speech-to-text, and optional text-to-speech
- Google Calendar API; Microsoft Graph Calendar = future connector (do not fully implement)
- Vercel-compatible frontend, Convex backend, Tailwind, shadcn/ui or clean reusable
  components, Zod validation
- **Do not** use Supabase, Prisma, or Express. **Do not** create a separate backend server or
  separate frontend/backend apps. One full-stack repo.

## Modules

1. **Auth & workspaces** — Clerk login; every user belongs to a workspace; multi-client/
   multi-company from the start; roles owner/admin/member/approver; all pages protected;
   every Convex function verifies user + workspace access; no cross-workspace access.
2. **Dashboard** — today's tasks, upcoming reminders, upcoming events, pending approvals,
   active monitors, recent assistant actions, recent audit logs.
3. **AI assistant page** (`/assistant`) — text chat, browser-microphone voice input,
   conversation history, responses, suggested actions, pending confirmation cards. OpenAI
   tool/function-calling. The AI calls safe backend tools (`createTask`, `createReminder`,
   `createCalendarEvent`, `createAvailabilityMonitor`, `createPurchaseRequest`,
   `listPendingApprovals`, `listTodaySchedule`, `listTasks`, `listReminders`) — never the DB
   directly. Every action creates an audit log entry.
4. **Calendar** — connect Google Calendar (OAuth, server-side tokens), connection status,
   create events from assistant, list upcoming, internal fallback, clear errors.
   `CalendarProvider` interface + `GoogleCalendarProvider` + `MicrosoftCalendarProvider`
   placeholder.
5. **Tasks & reminders** — `/tasks` and `/reminders`, full CRUD; reminders via Convex
   scheduled functions; in-app delivery for the MVP.
6. **Approvals** — `/approvals`; approval types purchase_request, ticket_booking_request,
   external_website_action, calendar_action_if_needed; only owner/admin/approver decide;
   every decision audit-logged; assistant explains it prepared a request and cannot complete
   payment/OTP.
7. **Availability monitoring** — `/monitors`; manual + assistant-created; dashboard surface;
   Convex cron; no aggressive scraping / no bypassing protections. `AutomationProvider`
   interface + `ManualMonitorProvider` + `Browserbase`/`Browserless` placeholders.
8. **Purchase request flow** — prepare requests (never auto-purchase): create monitor if
   needed, create purchase request when condition met, require approval before checkout, log
   everything, store no payment secrets.
9. **Audit logs** — `auditLogs` table; log the full set of actions; `/admin/audit-logs`
   visible to owner/admin only.
10. **Notifications** — `notifications` table; in-app bell for the MVP.
11. **Convex schema** — all tables with proper indexes; Clerk auth integration; all functions
    workspace-scoped.
12. **UI pages** — login (Clerk), dashboard, assistant, tasks, reminders, calendar, monitors,
    approvals, settings, settings/integrations, admin/audit-logs; clean sidebar; Audit Logs
    only for owner/admin.
13. **Assistant behavior** — helpful but careful; confirms sensitive actions; never claims it
    paid/purchased unless a human approved and completed it; creates structured records; shows
    clear next steps.
14. **Security** — OAuth not passwords; store no website passwords/payment secrets/OTP/CVV;
    never expose tokens in frontend; server-side Convex actions for external APIs; validate all
    inputs with Zod; permission + workspaceId checks everywhere; TODOs for production
    encryption/rate limiting/secret rotation; no fake security claims.
15. **Environment variables** — `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
    `CLERK_SECRET_KEY`, `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
    `GOOGLE_REDIRECT_URI`, optional `BROWSERBASE_API_KEY`, `BROWSERLESS_TOKEN`. No hardcoded
    secrets.
16. **Quality** — typed, clean, reusable components; loading/error/empty states; responsive,
    desktop-first; typecheck + lint pass; organized Convex functions; protected routes; README.

## Acceptance criteria

Sign in; create/select a workspace; open dashboard; use assistant chat; create a task,
reminder, monitor, and approval request from the assistant; approve/reject with permission;
see audit logs as admin; connect Google Calendar or see the flow clearly; create an internal
calendar event (Google when configured); **no payment/OTP/CVV/UPI handling exists**; all
sensitive actions require approval; workspace data is isolated; deployable as one Next.js +
Convex full-stack project.

## Explicitly out of scope for the MVP

Real Amazon/BookMyShow checkout; payment automation; OTP automation; captcha bypass; a
separate backend; unnecessary microservices; Redis; Supabase; Prisma.
