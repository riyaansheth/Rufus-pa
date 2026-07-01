# Rufuspa — Secure AI Executive Assistant

A supervised AI executive/personal assistant for teams and clients. Talk or type to an
assistant that schedules calendar events, creates reminders and tasks, monitors
products/events/booking pages, and **prepares purchase requests that require human
approval**. It never completes payments, OTPs, UPI, card entry, or checkout — a human
always does the final sensitive step.

> **Positioning:** AI executive assistant for teams that manages calendar, reminders, task
> tracking, availability monitoring, and purchase-request preparation with human approval
> and audit logs.

Single full-stack repo: **Next.js (App Router)** for the app + **Convex** for
backend/database/realtime/scheduled functions. **Clerk** auth, **OpenAI** assistant +
speech-to-text, **Google Calendar** integration (Microsoft Graph designed as a future
connector). Tailwind + a small hand-rolled shadcn-style component kit. Zod validation.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| App | Next.js 15 (App Router), React 19, TypeScript |
| Backend / DB / realtime / cron | Convex |
| Auth | Clerk |
| AI | OpenAI (chat + tool calling, transcription) |
| Calendar | Google Calendar API (`googleapis`); Microsoft = future connector |
| UI | Tailwind CSS v3 + custom components, lucide-react icons |
| Validation | Zod + Convex validators |

There is **no separate backend server** — Next.js handles the app and Convex handles all
backend/database logic in one repo.

---

## Prerequisites

- Node.js 18+ (tested on Node 20/26)
- Accounts: [Convex](https://convex.dev), [Clerk](https://clerk.com),
  [OpenAI](https://platform.openai.com); optional [Google Cloud](https://console.cloud.google.com)
  for calendar.

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# fill in the values (see "Environment variables" below)

# 3. Start Convex (in one terminal) — this also generates convex/_generated and
#    prints your NEXT_PUBLIC_CONVEX_URL. Paste that URL into .env.local.
npx convex dev

# 4. Start Next.js (in another terminal)
npm run dev
# or run both together:
npm run dev:all
```

Open http://localhost:3000.

### Wiring Clerk ↔ Convex

1. In Clerk, create a **JWT template named `convex`** (Clerk Dashboard → JWT Templates →
   "Convex"). Copy the **Issuer** URL.
2. Set it on your Convex deployment:
   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
   ```
3. Put your Clerk publishable + secret keys in `.env.local`.
4. (Optional) Clerk webhook → Convex user sync: point a Clerk webhook at
   `https://<your-deployment>.convex.site/clerk-webhook` and
   `npx convex env set CLERK_WEBHOOK_SECRET whsec_...`. This is optional — the app also
   lazily syncs the signed-in user on first load.

### Assistant (OpenAI)

The assistant runs inside a Convex **action**, so set the key on the Convex deployment:
```bash
npx convex env set OPENAI_API_KEY sk-...
```
`OPENAI_API_KEY` is also read by the Next.js `/api/transcribe` route (voice input), so keep
it in `.env.local` too.

### Google Calendar (optional)

1. Google Cloud Console → create an **OAuth 2.0 Client (Web application)**.
2. Authorized redirect URI: `http://localhost:3000/api/integrations/google/callback`.
3. Enable the **Google Calendar API**.
4. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in `.env.local`.
5. In the app: **Settings → Integrations → Connect Google Calendar**.

Without Google configured, calendar events fall back to an internal Convex-stored calendar.

---

## Environment variables

See [`.env.example`](./.env.example). Summary:

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Next | Convex deployment URL (from `convex dev`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next | Clerk client key |
| `CLERK_SECRET_KEY` | Next | Clerk server key |
| `OPENAI_API_KEY` | Convex **and** Next | Assistant (Convex) + transcription (Next route) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Next | Google Calendar OAuth |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | Verifies Clerk identity tokens |
| `CLERK_WEBHOOK_SECRET` | Convex | (Optional) Clerk webhook user sync |
| `BROWSERBASE_API_KEY` / `BROWSERLESS_TOKEN` | — | (Optional) placeholders for future monitors |

No secrets are hardcoded. Tokens are never exposed to the client.

---

## Scripts

```bash
npm run dev         # Next.js dev server
npm run dev:convex  # Convex dev (codegen + backend)
npm run dev:all     # both in parallel
npm run build       # Next.js production build
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
```

---

## Deploy (Vercel + Convex)

1. **Convex:** `npx convex deploy` (prod). Set prod env vars:
   `npx convex env set OPENAI_API_KEY ...`, `... CLERK_JWT_ISSUER_DOMAIN ...`, etc.
2. **Vercel:** import the repo. Set env vars (`NEXT_PUBLIC_CONVEX_URL` = prod Convex URL,
   Clerk keys, `OPENAI_API_KEY`, Google keys, `NEXT_PUBLIC_APP_URL` = your Vercel URL).
3. Update the Google OAuth redirect URI and `GOOGLE_REDIRECT_URI` to the production URL.
4. Point the Clerk `convex` JWT template + (optional) webhook at production.

---

## What's complete

- Clerk auth + multi-workspace/multi-tenant model with roles (owner/admin/member/approver).
- Every Convex query/mutation/action is workspace-scoped and permission-checked.
- Dashboard (tasks, reminders, events, approvals, monitors, recent activity).
- AI assistant page (text + browser-microphone voice) with OpenAI tool-calling; the model
  calls safe backend tools only, never the DB directly. Suggested actions + confirmation cards.
- Tasks, Reminders (with a 1-minute Convex cron that triggers them), Calendar (internal +
  Google mirror), Monitors, Approvals, Settings, Integrations, Admin audit logs.
- Approval system with role-gated approve/reject and full audit logging.
- Availability monitors with a modular automation-provider abstraction + a 5-minute cron.
- In-app notifications with a bell + unread count.
- Audit logs for every action; `/admin/audit-logs` visible to owner/admin only.
- Google Calendar OAuth connect flow with server-side token storage.
- Loading / empty / error states; responsive, desktop-first layout.

## What's stubbed for later

- **Microsoft Graph calendar** — provider interface + placeholder only (`MicrosoftCalendarProvider`).
- **Browserbase / Browserless monitors** — placeholders; the MVP uses a `ManualMonitorProvider`
  that performs **no scraping** and no automated browsing.
- **Notification delivery** — in-app only; email/SMS/WhatsApp/push are future integrations.
- **Real Amazon/BookMyShow checkout** — intentionally **never** built (see below).

## Security limitations that need production hardening

- **OAuth token encryption at rest.** Tokens are stored server-side in Convex and never sent
  to the client, but they are not yet encrypted at rest. Encryption is isolated to
  `convex/calendarConnections.ts` (see `TODO(production)` markers) so it can be added in one place.
- **OAuth `state` signing.** The Google `state` parameter currently carries the workspaceId
  unsigned; sign/verify it (HMAC) before production (`src/app/api/integrations/google/start`).
- **Rate limiting & secret rotation** are not implemented (marked with TODOs).
- **Browser automation is not production-safe** and is not implemented — the placeholders throw.

## Product safety guarantees (by design)

The assistant is **supervised**, not an auto-purchase bot. It does **not**: read or enter OTPs;
store UPI PIN, CVV, card, or banking secrets; bypass captchas/queues/website security; make
hidden purchases; share credentials between users; or perform irreversible actions without
confirmation. For Amazon/BookMyShow/etc. it may **monitor, alert, open/prepare the flow, and
create an approval request** — the human always completes the final payment/OTP/booking step.

See [`architecture.md`](./architecture.md) for the full design and [`CLAUDE.md`](./CLAUDE.md)
for repo conventions.
