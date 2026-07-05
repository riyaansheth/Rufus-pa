"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Calendar, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { PageHeader, RequireWorkspace } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

export default function IntegrationsPage() {
  // useSearchParams (read inside <Integrations>) requires a Suspense boundary in
  // the Next.js App Router production build.
  return (
    <Suspense>
      <RequireWorkspace>
        {(id) => <Integrations workspaceId={id} />}
      </RequireWorkspace>
    </Suspense>
  );
}

function Integrations({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const params = useSearchParams();
  const { toast } = useToast();
  const connections = useQuery(api.calendarConnections.status, { workspaceId });
  const disconnect = useMutation(api.calendarConnections.disconnect);

  const google = connections?.find((c) => c.provider === "google");
  const googleConnected = google?.status === "connected";

  React.useEffect(() => {
    if (params.get("connected")) {
      toast({ title: "Google Calendar connected", variant: "success" });
    } else if (params.get("error")) {
      toast({
        title: "Google connection failed",
        description: params.get("error") ?? undefined,
        variant: "error",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Integrations"
        description="Connect external services. Tokens are stored server-side and never exposed to the browser."
      />

      <div className="space-y-4">
        {/* Google Calendar */}
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Calendar className="size-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Google Calendar</CardTitle>
                <CardDescription>
                  Create and sync events. Uses OAuth — we never see your password.
                </CardDescription>
              </div>
            </div>
            {connections === undefined ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : googleConnected ? (
              <Badge variant="success">Connected</Badge>
            ) : google?.status === "error" ? (
              <Badge variant="destructive">Error</Badge>
            ) : (
              <Badge variant="secondary">Not connected</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {googleConnected ? (
              <>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  Connected{google?.accountEmail ? ` as ${google.accountEmail}` : ""}.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await disconnect({ workspaceId, provider: "google" });
                    toast({ title: "Disconnected", variant: "default" });
                  }}
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                {google?.status === "error" && google.lastError ? (
                  <p className="flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle className="size-4" />
                    {google.lastError}
                  </p>
                ) : null}
                <Button
                  size="sm"
                  onClick={() => {
                    window.location.href = `/api/integrations/google/start?workspaceId=${workspaceId}`;
                  }}
                >
                  Connect Google Calendar
                </Button>
                <p className="text-xs text-muted-foreground">
                  You&apos;ll be redirected to Google to grant calendar access. Requires
                  GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI to be configured.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Microsoft — future connector */}
        <Card className="opacity-70">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <Calendar className="size-5 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">Microsoft Calendar</CardTitle>
                <CardDescription>
                  Microsoft Graph calendar — planned future connector.
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline">Coming soon</Badge>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              The provider abstraction is in place (MicrosoftCalendarProvider). This
              connector is not implemented in the MVP.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
