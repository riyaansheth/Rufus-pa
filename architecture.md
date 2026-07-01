# Architecture — Rufuspa

## 1. Overview

Rufuspa is a single full-stack repository:

- **Next.js (App Router)** renders the UI and hosts a few thin API route handlers
  (OAuth redirect exchange, speech-to-text proxy).
- **Convex** is the entire backend: database, realtime queries, mutations, actions
  (for external API calls), and scheduled/cron functions.
- **Clerk** provides authentication; Convex verifies Clerk-issued JWTs.
- **OpenAI** powers the assistant (chat + tool calling) and transcription.
- **Google Calendar** is the first real calendar connector behind a provider interface.

There is no standalone server and no second app. The frontend talks to Convex directly via
the Convex React client, authenticated with the user's Clerk token.

```
Browser (Next.js/React)
   │  Convex React client (Clerk JWT)
   ▼
Convex  ──► queries/mutations (DB, workspace-scoped, permission-checked)
   │    └─► actions (OpenAI, Google Calendar)  ──► external APIs
   │    └─► crons (reminders sweep, monitor checks)
   ▼
Convex DB (documents + indexes)

Next.js route handlers (server): /api/transcribe (OpenAI), /api/integrations/google/*
Convex HTTP action: /clerk-webhook (user sync)
```

## 2. Multi-tenancy & authorization

- A **workspace** = one client/company/team. Users join via **memberships** with a role:
  `owner | admin | approver | member`.
- The single most important invariant: **every workspace-scoped function calls
  `requireWorkspaceAccess(ctx, workspaceId, allowedRoles?)`** (`convex/lib/auth.ts`) before
  touching data. It verifies (1) a valid Clerk identity, (2) a membership row for that user
  in that workspace, and (3) an optional role allow-list.
- All domain tables carry `workspaceId`, and all reads are filtered by it via indexes
  (`by_workspace`, `by_workspace_status`, `by_workspace_user`). **No query can return another
  workspace's rows.**
- Role gates:
  - Approvals: approve/reject requires `owner | admin | approver` (`APPROVER_ROLES`).
  - Audit logs / member role changes: `owner | admin` (`ADMIN_ROLES`).

## 3. Data model (`convex/schema.ts`)

`users`, `workspaces`, `memberships`, `tasks`, `reminders`, `calendarConnections`,
`calendarEvents`, `assistantConversations`, `assistantMessages`, `approvalRequests`,
`monitors`, `auditLogs`, `notifications`.

Indexes follow the access patterns: `by_workspace`, `by_user`, `by_status`, `by_dueAt`,
`by_remindAt`, `by_createdAt`, `by_workspace_status`, `by_workspace_user`, plus
`by_clerkUser`, `by_conversation`, `by_workspace_start`, `by_workspace_createdAt`.

## 4. The AI assistant (safety-critical)

File: `convex/assistant.ts` (action) + `convex/assistantData.ts` (persistence).

**The model never touches the database.** The flow:

1. UI calls the `assistant.sendMessage` **action** with the workspace, optional
   conversation, and the user's text.
2. The action verifies workspace access, persists the user message, and audit-logs the
   command (`assistant.command_received`).
3. It calls OpenAI Chat Completions with a fixed **tool schema** and a strict system prompt
   encoding the supervised-assistant safety rules.
4. When the model emits tool calls, `dispatchTool` validates the arguments with **Zod** and
   routes each to the **same workspace-guarded Convex function a human uses**
   (`tasks.create`, `reminders.create`, `monitors.create`, `approvals.create`,
   `calendar.createEvent`, and the read-only `list*` queries). Nothing else is callable.
5. Tool results are fed back; the loop is bounded (max 6 iterations).
6. The final assistant message is stored with structured **action cards** (links to the
   records it created), which the UI renders as confirmation cards.

Because sensitive/money actions map to `approvals.create` (an approval **request**), the
assistant can never complete a purchase, booking, payment, or OTP step.

## 5. Calendar (provider abstraction)

- Interface: `CalendarProvider` (`convex/integrations/calendarProvider.ts`).
- `GoogleCalendarProvider` (`convex/googleCalendar.ts`, Node runtime) — real implementation
  via `googleapis`. Exposed as an internal action.
- `MicrosoftCalendarProvider` (`convex/integrations/microsoftCalendar.ts`) — placeholder
  that throws; structurally ready for Microsoft Graph.
- `calendar.createEvent` (action) always writes an internal `calendarEvents` row, then, if
  the workspace has a connected Google account, mirrors the event to Google and stores the
  external id. A Google failure is recorded as `integration.failed` and never blocks the
  internal event (graceful fallback).
- OAuth: `src/app/api/integrations/google/{start,callback}` handle the redirect dance.
  Tokens are exchanged server-side and stored via an authenticated Convex mutation. Token
  fields live only in `calendarConnections` and are returned to the client **only** through
  the `status` query, which omits the tokens.

## 6. Monitors & automation (provider abstraction)

- Interface: `AutomationProvider` (`convex/integrations/automationProvider.ts`).
- `ManualMonitorProvider` (MVP) — performs **no scraping / no headless browsing**. It marks
  monitors as needing human verification.
- `BrowserbaseProvider` / `BrowserlessProvider` — placeholders that throw, showing where a
  future opt-in, ToS-respecting, read-only integration plugs in.
- A monitor that (via a future real provider) reports `conditionMet` triggers
  `approvals.create` — an approval **request**, never a purchase — and marks itself completed.

## 7. Scheduled functions (`convex/crons.ts`, `convex/scheduled.ts`)

- `trigger-due-reminders` (every 1 min): moves due reminders to `triggered`, creates an
  in-app notification, and audit-logs.
- `run-monitor-checks` (every 5 min): runs due monitors through the (manual) provider and
  records results. Each monitor is additionally gated by its own `checkFrequencyMinutes`.
  Intentionally gentle — no aggressive third-party polling.

## 8. Notifications & audit

- `notifications`: in-app only for the MVP (bell + unread count). Email/SMS/WhatsApp/push
  are future channels.
- `auditLogs`: append-only. Every state change writes an entry via `writeAuditLog`
  (`convex/lib/audit.ts`) with a closed set of action names. `/admin/audit-logs` is
  owner/admin only.

## 9. Frontend structure

- `src/app/(app)/*` — authenticated pages inside a sidebar shell (`(app)/layout.tsx`),
  which mounts `WorkspaceProvider` (active-workspace selection + role), a workspace switcher,
  the notification bell, and an onboarding gate.
- `src/components/ui/*` — a small, dependency-light shadcn-style component kit.
- `src/components/providers.tsx` — `ClerkProvider` → `ConvexProviderWithClerk` → `ToastProvider`.
- `src/middleware.ts` — Clerk middleware protecting every route except the landing page,
  auth pages, and webhooks.

## 10. Security model (summary)

- OAuth only; **no passwords, payment secrets, OTP, CVV, or UPI PIN are ever stored.**
- All external API calls happen in Convex actions / server route handlers; **no secret or
  token is ever exposed to the browser.**
- All inputs validated (Zod at assistant/route boundaries, Convex validators at function
  boundaries).
- Permission + `workspaceId` checks in every function.
- Explicit `TODO(production)` markers for token encryption at rest, OAuth state signing,
  rate limiting, and secret rotation. No fake security claims; automation placeholders are
  clearly non-production.
