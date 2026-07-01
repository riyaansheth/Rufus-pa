import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { google } from "googleapis";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export const runtime = "nodejs";

/**
 * Google OAuth callback. Exchanges the auth code for tokens, reads the account email,
 * and stores the connection in Convex under the workspace from `state`.
 *
 * Tokens are exchanged and persisted entirely server-side; they are never exposed to
 * the browser. The Convex mutation runs with the user's Clerk identity, so workspace
 * access is enforced there.
 */
export async function GET(req: NextRequest) {
  const { userId, getToken } = await auth();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const settingsUrl = `${appUrl}/settings/integrations`;

  if (!userId) return NextResponse.redirect(`${appUrl}/sign-in`);

  const code = req.nextUrl.searchParams.get("code");
  const workspaceId = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${settingsUrl}?error=${encodeURIComponent(error)}`);
  }
  if (!code || !workspaceId) {
    return NextResponse.redirect(`${settingsUrl}?error=missing_code`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!clientId || !clientSecret || !redirectUri || !convexUrl) {
    return NextResponse.redirect(`${settingsUrl}?error=not_configured`);
  }

  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    // Read the connected account's email for display.
    let accountEmail: string | undefined;
    try {
      const userinfo = await google.oauth2({ version: "v2", auth: oauth2 }).userinfo.get();
      accountEmail = userinfo.data.email ?? undefined;
    } catch {
      // Non-fatal: proceed without the email label.
    }

    if (!tokens.access_token) {
      return NextResponse.redirect(`${settingsUrl}?error=no_token`);
    }

    // Persist server-side via an authenticated Convex call.
    const convexToken = await getToken({ template: "convex" });
    if (!convexToken) {
      return NextResponse.redirect(`${settingsUrl}?error=auth`);
    }
    const client = new ConvexHttpClient(convexUrl);
    client.setAuth(convexToken);
    await client.mutation(api.calendarConnections.upsertGoogleConnection, {
      workspaceId: workspaceId as Id<"workspaces">,
      accountEmail,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      expiresAt: tokens.expiry_date ?? undefined,
      scope: tokens.scope ?? undefined,
    });

    return NextResponse.redirect(`${settingsUrl}?connected=1`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "exchange_failed";
    return NextResponse.redirect(`${settingsUrl}?error=${encodeURIComponent(msg)}`);
  }
}
