# CONTEXT.md — Rufuspa project context

A single source of truth for what this project is, how it's built, where it's deployed, and
what has been done. For AI-assistant coding conventions see `CLAUDE.md`; for the full product
spec see `prompt.md`; for design/data-flow see `architecture.md`; for setup see `README.md`.

---

## 1. What it is

**Rufuspa** — a **supervised** AI executive/personal assistant for teams. Users talk or type to
an assistant that schedules calendar events, creates reminders/tasks, monitors
products/movies/events, prepares purchase/booking **approval requests**, and answers questions
(with live web knowledge). Every sensitive or money-related action requires **explicit human
approval** — the assistant never completes payments, OTPs, or bookings itself.

Positioning: "AI executive assistant for teams that manages calendar, reminders, task tracking,
availability monitoring, and purchase-request preparation with human approval and audit logs."

## 2. The one inviolable rule

This is a **supervised** assistant, not an auto-purchase bot. It must **never**:
- read or enter OTPs; store UPI PIN, CVV, card, or banking secrets;
- bypass captchas/queues/website security;
- make hidden purchases or complete checkout without approval;
- share credentials between users;
- perform irreversible/money actions without explicit human approval.

For Amazon/BookMyShow/etc.: **monitor, alert, open/prepare the flow, and create an approval
request only.** The human always completes the final payment/OTP/booking step. Any new sensitive
capability must go through `approvalRequests` and be audit-logged.

## 3. Stack (strict)

- **Next.js (App Router) + TypeScript** — frontend + API route handlers
- **Convex** — backend, database, realtime, scheduled functions (crons), server actions
- **Clerk** — auth (JWT verified by Convex)
- **OpenAI** — assistant (tool-calling), speech-to-text, text-to-speech, hosted web search
- **Google Calendar API** — OAuth calendar sync (Microsoft Graph = future connector, stubbed)
- **Tailwind v3.4** + a hand-rolled shadcn-style component kit (`src/components/ui/*`)
- **Zod** — validation at assistant/HTTP boundaries; Convex validators (`v.*`) at function args

Prohibited: Supabase, Prisma, Express, a separate backend server, or split frontend/backend apps.
One full-stack repo.

## 4. Repo layout

- `convex/` — all backend, workspace-scoped.
  - `lib/auth.ts` — `requireWorkspaceAccess` (used in EVERY workspace fn), `APPROVER_ROLES`, `ADMIN_ROLES`.
  - `lib/audit.ts` — `writeAuditLog` (closed `AuditAction` union) + `notify`.
  - `lib/time.ts` — timezone helpers (shared by assistant + briefing cron).
  - `lib/deepLinks.ts` — best-effort booking/product links (search-style, no scraping).
  - `lib/googleSync.ts` — schedule Google sync from within mutations.
  - Domain modules: `tasks.ts`, `reminders.ts`, `monitors.ts`, `approvals.ts`, `calendar.ts`,
    `calendarConnections.ts`, `auditLogs.ts`, `notifications.ts`, `workspaces.ts`,
    `memberships.ts`, `users.ts`, `memory.ts`.
  - `assistant.ts` — OpenAI tool-calling action; `assistantData.ts` — conversation storage.
  - `googleCalendar.ts` — Node-runtime (`"use node"`) Google action.
  - `telegram.ts` — Telegram delivery channel (notifications only).
  - `integrations/` — `CalendarProvider`/`AutomationProvider` interfaces + impls/placeholders.
  - `scheduled.ts` + `crons.ts` — reminder sweep, monitor sweep, daily briefing.
  - `http.ts` — Clerk + Telegram webhooks.
  - `schema.ts` — all tables + indexes + shared validators.
  - `_generated/` — regenerate with `npx convex dev` after changing function signatures.
- `src/app/` — App Router. `(app)/` group = authed pages in the sidebar shell.
  - Pages: `dashboard`, `assistant`, `tasks`, `reminders`, `calendar`, `monitors`, `approvals`,
    `settings`, `settings/integrations`, `admin/audit-logs` (owner/admin only), `onboarding`.
  - API routes: `api/transcribe` (STT), `api/speak` (TTS, streaming),
    `api/integrations/google/{start,callback,auto}`.
  - `icon.svg` — app favicon (the brand "R" mark).
- `src/components/` — providers, app shell, `ui/*` kit, `logo.tsx`, `profile-setup.tsx`,
  `use-voice-recorder.tsx`, `quick-capture.tsx`, etc.
- `src/middleware.ts` — Clerk route protection (public: `/`, `/sign-in`, `/sign-up`, webhooks).

## 5. Core conventions

- **Workspace isolation is non-negotiable.** New tables carry `workspaceId`; new functions start
  with `requireWorkspaceAccess`. Never query without a workspace filter. (Personal tables like
  `users`/`userMemories` are keyed by Clerk user id and scoped to the caller.)
- **The assistant never touches the DB directly.** It emits tool calls → Zod-validated →
  dispatched to the SAME guarded Convex functions humans use. Sensitive/money → `approvalRequests`.
  There is deliberately NO approve/reject tool — approval is always a human click.
- **Manage-by-name tools** resolve records via `resolveByTitle` (one match acts; zero/many returns
  candidates so the model asks).
- **Audit everything** — state changes call `writeAuditLog` with an action from the closed union.
- **Secrets stay server-side** — API keys/tokens live in Convex/Next server code, never returned
  to the client. The calendar `status` query omits tokens.
- **External calls go in actions** (Convex `action`/`internalAction`) or Next route handlers.

## 6. Data model (Convex tables)

`users` (+ personal profile: `displayName`, `city`, `country`, `jobTitle`, `about`,
`profileCompletedAt`, `timezone`, briefing prefs, Telegram link), `userMemories` (personal
cross-workspace assistant memory), `workspaces` (with `inviteCode`), `memberships` (roles:
owner/admin/member/approver), `tasks`, `reminders`, `calendarConnections`, `calendarEvents`,
`assistantConversations`, `assistantMessages`, `approvalRequests`, `monitors`, `auditLogs`,
`notifications`.

## 7. Key feature notes

- **Assistant** (`convex/assistant.ts`): default model `gpt-5` at `reasoning_effort: minimal` +
  `verbosity: low` (fast); per-model-family param guarding; graceful fallback on API error;
  forces a final no-tools completion if the 6-step tool budget is exhausted. Tools: create/manage
  task, reminder, calendar event, monitor, purchase request; list queries; **webSearch** (OpenAI
  hosted Responses API); **rememberFact** + **updateProfile** (memory). Profile + memories are
  injected each turn so it never re-asks who/where the user is.
- **Memory**: profile collected in a **compulsory onboarding window** (`profile-setup.tsx`) shown
  before the app; `userMemories` accumulates durable facts the assistant learns.
- **Calendar**: real **month-grid** UI (`calendar/page.tsx`); shows internal + full Google
  calendar for the visible month; assistant can create AND fully edit events (title/time/
  location/description) with changes mirrored to Google.
- **Voice**: `/api/transcribe` (STT, language pinned to `en` by default via
  `OPENAI_TRANSCRIBE_LANGUAGE`) and `/api/speak` (streaming TTS, `tts-1`, `OPENAI_TTS_SPEED`
  default 1.1). Client plays via MediaSource so audio starts before full synthesis. Silence
  auto-stop is 1.1s.
- **Monitors**: manual provider (no scraping). A met condition creates an approval request +
  notifies; never a purchase. Browserbase/Browserless are placeholders for a future real provider.
- **Deep links**: movie/event links use the bare film name + city as a BookMyShow-scoped search
  (no scraping of internal event IDs). Amazon for products. An explicit user URL always wins.

## 8. Deployment (LIVE)

- **GitHub**: `git@github.com:riyaansheth/Rufus-pa.git`, branch `main`. Every push auto-deploys
  the frontend on Vercel.
- **Frontend (Vercel)**: project `rufuspa` (team `riyaansheth-7979s-projects`) →
  **https://rufuspa.vercel.app**
- **Backend (Convex)**:
  - dev: `dev:prestigious-penguin-12` → https://prestigious-penguin-12.convex.cloud
  - **prod: `trustworthy-llama-389`** → https://trustworthy-llama-389.convex.cloud
  - Backend changes: `npx convex deploy` (prod). Frontend-only changes ship via Vercel on push.
- **Auth (Clerk)**: TEST instance. Issuer `https://dynamic-finch-55.clerk.accounts.dev`; JWT
  template named `convex`. Test keys work on the Vercel domain (shows a small dev badge). For a
  clean public launch, create a Clerk **production** instance and swap the 3 Clerk values.
- **Google OAuth**: redirect URI = `https://rufuspa.vercel.app/api/integrations/google/callback`
  (set on Vercel, Convex prod, and Google Cloud Console).

## 9. Environment variables

Values live in `~/rufuspa/.env.local` (gitignored) and on the deployments. **Never commit
secrets.** Names only:

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | Vercel/Next | Convex deployment URL (prod on Vercel) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Vercel/Next | Clerk client key (public) |
| `CLERK_SECRET_KEY` | Vercel/Next **and** Convex | Clerk server key |
| `OPENAI_API_KEY` | Convex **and** Vercel/Next | Assistant (Convex) + transcribe/speak (Next) |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | Verifies Clerk identity tokens |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Convex + Next | Google Calendar OAuth + refresh |
| `NEXT_PUBLIC_APP_URL` | Vercel/Next | Public app URL |
| `CLERK_WEBHOOK_SECRET` | Convex | (Optional) Clerk webhook user sync |
| `TELEGRAM_*` | Convex | (Optional) Telegram delivery |
| `OPENAI_ASSISTANT_MODEL` / `OPENAI_REASONING_EFFORT` | Convex | Tune assistant model/speed |
| `OPENAI_SEARCH_MODEL` / `OPENAI_WEB_SEARCH_TOOL` | Convex | Tune web search |
| `OPENAI_TTS_MODEL` / `OPENAI_TTS_VOICE` / `OPENAI_TTS_SPEED` | Next | Tune voice output |
| `OPENAI_TRANSCRIBE_MODEL` / `OPENAI_TRANSCRIBE_LANGUAGE` | Next | Tune voice input |

⚠️ Do **NOT** set `CONVEX_DEPLOYMENT` on Vercel — that's the local dev pointer.

## 10. Commands

```bash
npm run dev:all     # Next.js + Convex together (dev)
npm run typecheck   # tsc --noEmit   (must stay green)
npm run lint        # eslint         (must stay green)
npm run build       # production build check
npx convex dev      # regenerate convex/_generated + push to dev
npx convex deploy   # deploy backend to PROD (trustworthy-llama-389)
```
Note: local Next dev runs on port **3001** to match the Google OAuth redirect URI.

## 11. Work done in the latest session (chronological)

1. **Voice transcription language** pinned to English (fix: short words like "Mumbai" were
   mis-detected into another script). Env override `OPENAI_TRANSCRIBE_LANGUAGE`.
2. **Live web search** added to the assistant (OpenAI hosted); assistant is now real-time and
   answers on any topic. Default model bumped (later to GPT-5).
3. **Calendar became a real month grid** showing the full Google calendar; assistant can fully
   **edit** events (title/time/location/description), mirrored to Google.
4. **Assistant model → GPT-5** with minimal reasoning + low verbosity for speed.
5. **Assistant memory + compulsory profile onboarding** — profile + `userMemories`, injected
   each turn so it stops re-asking; `rememberFact`/`updateProfile` tools.
6. **Voice latency** — streaming TTS (MediaSource), `tts-1`, faster speaking rate, 1.1s silence
   auto-stop.
7. **Movie deep links** fixed to open the actual film (bare name + city); **recommended seats**
   researched via web search and noted on the monitor/approval (advisory only).
8. **Logo/favicon** added (`src/app/icon.svg` + `Logo` in the sidebar).
9. **Hosting** — Convex prod deployed (`trustworthy-llama-389`), Vercel connected, live at
   rufuspa.vercel.app, Google redirect pointed at prod.
10. **Security fixes** (from a parallel audit): cross-user Google token corruption
    (`updateAccessToken`/`recordFailure` now scoped by user), `disconnect` scoped to caller,
    `memory.add` validates `workspaceId`, correct `calendar.event_updated/deleted` audit actions.
11. **Autonomous improvement loop (3 iterations)**: resilient crons (per-item error isolation),
    assistant forces a final answer on tool-budget exhaustion + honest search-failure handling,
    approvals double-submit guard, monitor delete confirmation.

## 12. Known open items (flagged, not yet done)

- **Four-eyes on approvals**: an approver can approve their own request (policy decision).
- **Token encryption at rest** for Google `accessToken`/`refreshToken` (`TODO(production)`,
  centralized in `calendarConnections.ts`).
- **Invite-code rate limiting** on `workspaces.join`.
- **Not-yet-audited UI**: tasks/reminders destructive-delete confirmations, calendar month-grid
  edge cases (all-day/multi-day/timezone bucketing), voice streaming edges, dashboard aggregation,
  settings/integrations.
- **Clerk production instance** for a clean public launch (currently test keys).
- **Real monitor provider** (Browserbase/Browserless) — currently manual-only, never sets
  `conditionMet`.
- **DST edge** in `lib/time.ts` for naive wall-clock times (mitigated by offset-bearing ISO output).

## 13. Guardrails for future changes

- Mark production gaps with `TODO(production):`.
- Keep `npm run typecheck` and `npm run lint` green; run `npm run build` before shipping.
- Commit messages are plain (no AI attribution); local agent tooling (`.claude/`, `.agents/`,
  `AGENTS.md`, `skills-lock.json`) is gitignored.
- After changing Convex function signatures, run `npx convex dev` to regenerate `_generated`.
