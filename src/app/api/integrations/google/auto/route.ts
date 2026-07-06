import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export const runtime = "nodejs";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

/**
 * Auto-connect Google Calendar for users who signed in with Google.
 *
 * If the user's Clerk session came from a Google social login whose grant includes
 * the calendar scope (configured in Clerk → SSO connections → Google → custom
 * credentials + extra scopes), we register a "clerk"-sourced calendar connection —
 * no separate OAuth dance. Tokens are never stored; the backend fetches a fresh
 * one from Clerk per sync. Fired once per workspace on app load; idempotent.
 */
export async function POST(req: NextRequest) {
  const { userId, getToken } = await auth();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  let workspaceId: string | undefined;
  try {
    const body = (await req.json()) as { workspaceId?: string };
    workspaceId = body.workspaceId;
  } catch {
    // fallthrough
  }
  if (!workspaceId) {
    return new NextResponse("Missing workspaceId", { status: 400 });
  }

  try {
    const client = await clerkClient();

    // Does this user have a Google social login with a usable token?
    const tokenRes = await client.users.getUserOauthAccessToken(
      userId,
      "oauth_google",
    );
    const tokens = Array.isArray(tokenRes) ? tokenRes : tokenRes.data;
    const googleToken = tokens?.[0] as
      | { token?: string; scopes?: string[] }
      | undefined;
    if (!googleToken?.token) {
      return NextResponse.json({ connected: false, reason: "no_google_login" });
    }
    // Only auto-connect when the sign-in grant actually includes calendar access.
    const scopes = googleToken.scopes ?? [];
    const hasCalendarScope = scopes.some((s) => s.startsWith(CALENDAR_SCOPE));
    if (!hasCalendarScope) {
      return NextResponse.json({ connected: false, reason: "missing_scope" });
    }

    // Label the connection with the Google account email.
    let accountEmail: string | undefined;
    try {
      const user = await client.users.getUser(userId);
      accountEmail =
        user.externalAccounts.find((a) => a.provider === "oauth_google")
          ?.emailAddress ?? user.primaryEmailAddress?.emailAddress ?? undefined;
    } catch {
      // non-fatal
    }

    // Register the connection in Convex with the user's own identity (workspace
    // access is enforced by the mutation).
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    const convexToken = await getToken({ template: "convex" });
    if (!convexUrl || !convexToken) {
      return NextResponse.json({ connected: false, reason: "not_configured" });
    }
    const convex = new ConvexHttpClient(convexUrl);
    convex.setAuth(convexToken);
    const result = await convex.mutation(
      api.calendarConnections.upsertClerkConnection,
      { workspaceId: workspaceId as Id<"workspaces">, accountEmail },
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({
      connected: false,
      reason: err instanceof Error ? err.message : "error",
    });
  }
}
