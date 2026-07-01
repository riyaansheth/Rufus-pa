import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { google } from "googleapis";

export const runtime = "nodejs";

/**
 * Begin Google Calendar OAuth. Redirects the user to Google's consent screen.
 *
 * The workspaceId is passed through the OAuth `state` parameter so the callback knows
 * which workspace to attach the connection to.
 *
 * TODO(production): sign/encrypt the `state` value (e.g. HMAC) to prevent tampering,
 * and validate it in the callback. For the MVP it carries the workspaceId only.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return new NextResponse("Missing workspaceId", { status: 400 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return new NextResponse(
      "Google Calendar is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.",
      { status: 501 },
    );
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    state: workspaceId,
  });

  return NextResponse.redirect(url);
}
