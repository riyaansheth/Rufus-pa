/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as approvals from "../approvals.js";
import type * as assistant from "../assistant.js";
import type * as assistantData from "../assistantData.js";
import type * as auditLogs from "../auditLogs.js";
import type * as calendar from "../calendar.js";
import type * as calendarConnections from "../calendarConnections.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as googleCalendar from "../googleCalendar.js";
import type * as http from "../http.js";
import type * as integrations_automationProvider from "../integrations/automationProvider.js";
import type * as integrations_browserbase from "../integrations/browserbase.js";
import type * as integrations_browserless from "../integrations/browserless.js";
import type * as integrations_calendarProvider from "../integrations/calendarProvider.js";
import type * as integrations_manualMonitor from "../integrations/manualMonitor.js";
import type * as integrations_microsoftCalendar from "../integrations/microsoftCalendar.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_deepLinks from "../lib/deepLinks.js";
import type * as lib_googleSync from "../lib/googleSync.js";
import type * as lib_time from "../lib/time.js";
import type * as memberships from "../memberships.js";
import type * as memory from "../memory.js";
import type * as monitors from "../monitors.js";
import type * as movies from "../movies.js";
import type * as notifications from "../notifications.js";
import type * as reminders from "../reminders.js";
import type * as scheduled from "../scheduled.js";
import type * as tasks from "../tasks.js";
import type * as telegram from "../telegram.js";
import type * as users from "../users.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  approvals: typeof approvals;
  assistant: typeof assistant;
  assistantData: typeof assistantData;
  auditLogs: typeof auditLogs;
  calendar: typeof calendar;
  calendarConnections: typeof calendarConnections;
  crons: typeof crons;
  email: typeof email;
  googleCalendar: typeof googleCalendar;
  http: typeof http;
  "integrations/automationProvider": typeof integrations_automationProvider;
  "integrations/browserbase": typeof integrations_browserbase;
  "integrations/browserless": typeof integrations_browserless;
  "integrations/calendarProvider": typeof integrations_calendarProvider;
  "integrations/manualMonitor": typeof integrations_manualMonitor;
  "integrations/microsoftCalendar": typeof integrations_microsoftCalendar;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/deepLinks": typeof lib_deepLinks;
  "lib/googleSync": typeof lib_googleSync;
  "lib/time": typeof lib_time;
  memberships: typeof memberships;
  memory: typeof memory;
  monitors: typeof monitors;
  movies: typeof movies;
  notifications: typeof notifications;
  reminders: typeof reminders;
  scheduled: typeof scheduled;
  tasks: typeof tasks;
  telegram: typeof telegram;
  users: typeof users;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
