# CLAUDE.md — Guide for AI coding assistants working in this repo

This file orients future Claude Code (or similar) sessions. Read it before making changes.

## What this project is

**Rufuspa** — a supervised AI executive assistant for teams. Single full-stack repo:
Next.js (App Router) + Convex + Clerk + OpenAI + Google Calendar. See `architecture.md` for
the full design and `README.md` for setup.

## The one rule you must never break

This is a **supervised** assistant, not an auto-purchase bot. Do **not** add features that:
read/enter OTPs; store UPI PIN, CVV, card, or banking secrets; bypass captchas/queues/website
security; make hidden purchases without approval; share credentials between users; or perform
irreversible/money actions without explicit human approval.

For Amazon/BookMyShow/etc.: monitor, alert, open/prepare the flow, and create an **approval
request** only. The human always completes the final payment/OTP/booking step. Any new
sensitive capability must go through `approvalRequests` and be audit-logged.

## Commands

```bash
npm run dev:all     # Next.js + Convex together
npm run typecheck   # tsc --noEmit   (must stay green)
npm run lint        # eslint         (must stay green)
npx convex dev      # regenerates convex/_generated and pushes functions
```

## Repo layout

- `convex/` — all backend. Functions are workspace-scoped; see `lib/auth.ts`.
  - `lib/auth.ts` — `requireWorkspaceAccess` (use it in EVERY workspace function),
    `APPROVER_ROLES`, `ADMIN_ROLES`.
  - `lib/audit.ts` — `writeAuditLog` (call on every state change) + `notify`.
  - Domain modules: `tasks.ts`, `reminders.ts`, `monitors.ts`, `approvals.ts`,
    `calendar.ts`, `calendarConnections.ts`, `auditLogs.ts`, `notifications.ts`,
    `workspaces.ts`, `memberships.ts`, `users.ts`.
  - `assistant.ts` — OpenAI tool-calling action; `assistantData.ts` — conversation storage.
  - `integrations/` — `CalendarProvider` + `AutomationProvider` interfaces and impls/placeholders.
  - `googleCalendar.ts` — Node-runtime (`"use node"`) Google action.
  - `scheduled.ts` + `crons.ts` — reminder + monitor sweeps.
  - `http.ts` — Clerk webhook.
  - `_generated/` — normally produced by `convex dev`; committed here for offline typecheck.
    **Re-run `npx convex dev` after adding/removing functions** to regenerate it.
- `src/app/` — App Router. `(app)/` group = authed pages in the sidebar shell.
- `src/components/` — providers, app shell, and `ui/` component kit.
- `src/middleware.ts` — Clerk route protection.

## Conventions & patterns

- **Workspace isolation is non-negotiable.** New tables carry `workspaceId`; new functions
  start with `requireWorkspaceAccess`. Never query without a workspace filter.
- **The assistant never mutates the DB directly.** To give it a new capability, add a
  guarded Convex function, then add a tool in `assistant.ts` (schema + Zod validation +
  a `dispatchTool` case that calls the guarded function). Nothing else.
- **Manage-by-name tools** (`manageTask`/`manageReminder`/`manageCalendarEvent`/
  `manageMonitor`) resolve records via `resolveByTitle` — one match acts, zero/many
  returns candidates so the model asks. Keep that pattern for new manage tools. There is
  deliberately NO approve/reject tool: approval decisions stay a human click.
- **Voice**: `/api/transcribe` (STT) and `/api/speak` (TTS, `OPENAI_TTS_MODEL`) are
  Clerk-gated Next routes; `use-voice-recorder.tsx` auto-stops on silence and auto-sends.
  Timezone helpers live in `convex/lib/time.ts` (shared by assistant + briefing cron).
- **Audit everything.** State changes call `writeAuditLog` with an action from the closed
  `AuditAction` union in `lib/audit.ts` (extend the union if you add an action).
- **Secrets stay server-side.** External API keys/tokens live in Convex/Next server code and
  are never returned to the client. The calendar `status` query intentionally omits tokens.
- **External calls go in actions** (Convex `action`/`internalAction`) or Next route handlers,
  not queries/mutations.
- **Validation:** Zod at assistant/HTTP boundaries; Convex validators (`v.*`) at function args.
- **UI:** reuse the `components/ui/*` kit; always provide loading, empty, and error states;
  desktop-first responsive layout; use the `useToast` hook for feedback.
- **Money/sensitive TODOs:** mark production gaps with `TODO(production):` (token encryption,
  OAuth state signing, rate limiting, secret rotation).

## Adding a new provider (calendar or automation)

Implement the interface in `convex/integrations/`, wire one action, and register it — callers
don't change. Placeholders (`Microsoft*`, `Browserbase*`, `Browserless*`) show the shape.

## Gotchas

- After changing Convex function signatures, `convex/_generated` may be stale until you run
  `npx convex dev`. Keep `npm run typecheck` green.
- `googleCalendar.ts` uses the Node runtime (`"use node"`) because `googleapis` needs Node;
  keep Node-only deps out of default-runtime files.
- `OPENAI_API_KEY` must be set on **both** the Convex deployment (assistant) and Next env
  (the `/api/transcribe` route).
- For Google Calendar token refresh to work, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
  (and `GOOGLE_REDIRECT_URI`) must be set on the **Convex deployment** too — not only in Next
  (where the OAuth routes read them). The mirror action refreshes the access token server-side
  and persists it via `calendarConnections.updateAccessToken`.
- Multi-user: workspaces have an `inviteCode`; teammates join via Settings → invite code
  (`workspaces.join`). Owners/admins then assign roles. This is what makes the approver flow
  testable with more than one person.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
