"use client";

import * as React from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Calendar, Plus, Loader2, Trash2, ExternalLink, RefreshCw } from "lucide-react";
import { PageHeader, EmptyState, RequireWorkspace } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

export default function CalendarPage() {
  return (
    <RequireWorkspace>{(id) => <CalendarView workspaceId={id} />}</RequireWorkspace>
  );
}

type GoogleEvent = {
  externalId: string;
  title?: string;
  start?: string;
  end?: string;
  htmlLink?: string;
};

function CalendarView({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const [open, setOpen] = React.useState(false);
  const events = useQuery(api.calendar.listUpcoming, { workspaceId, limit: 50 });
  const connections = useQuery(api.calendarConnections.status, { workspaceId });
  const removeEvent = useMutation(api.calendar.remove);
  const listGoogle = useAction(api.googleCalendar.listGoogleEvents);
  const { toast } = useToast();
  const googleConnected = connections?.some(
    (c) => c.provider === "google" && c.status === "connected",
  );

  // Live Google Calendar events (actions aren't reactive — fetched on load/refresh).
  const [googleEvents, setGoogleEvents] = React.useState<GoogleEvent[] | null>(
    null,
  );
  const [googleLoading, setGoogleLoading] = React.useState(false);
  const refreshGoogle = React.useCallback(async () => {
    setGoogleLoading(true);
    try {
      const res = await listGoogle({ workspaceId, maxResults: 30 });
      setGoogleEvents(res.events);
      if (res.error) {
        toast({
          title: "Google Calendar fetch failed",
          description: res.error,
          variant: "error",
        });
      }
    } catch {
      // non-fatal; internal calendar still shows
    } finally {
      setGoogleLoading(false);
    }
  }, [listGoogle, workspaceId, toast]);

  React.useEffect(() => {
    if (googleConnected) void refreshGoogle();
  }, [googleConnected, refreshGoogle]);

  // Google events not already mirrored as internal rows (avoid duplicates).
  const internalExternalIds = new Set(
    (events ?? []).map((e) => e.externalId).filter(Boolean),
  );
  const googleOnly = (googleEvents ?? []).filter(
    (g) => g.externalId && !internalExternalIds.has(g.externalId),
  );

  return (
    <div>
      <PageHeader
        title="Calendar"
        description={
          googleConnected
            ? "Connected to Google Calendar — new events are mirrored there."
            : "Using the internal calendar. Connect Google Calendar to sync."
        }
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New event
          </Button>
        }
      />

      {!googleConnected ? (
        <Card className="mb-4 bg-muted/30">
          <CardContent className="flex items-center justify-between pt-5 text-sm">
            <span className="text-muted-foreground">
              Google Calendar is not connected. Events are stored internally.
            </span>
            <Link href="/settings/integrations">
              <Button variant="outline" size="sm">
                Connect
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {events === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No upcoming events"
          description="Create an event, or ask the assistant: 'Schedule a meeting with Aman tomorrow at 5.'"
          action={<Button onClick={() => setOpen(true)}>New event</Button>}
        />
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <Card key={e._id}>
              <CardContent className="flex items-center gap-3 py-3.5">
                <div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-md border text-center">
                  <span className="text-[10px] uppercase text-muted-foreground">
                    {new Date(e.startAt).toLocaleString(undefined, {
                      month: "short",
                    })}
                  </span>
                  <span className="text-sm font-semibold leading-none">
                    {new Date(e.startAt).getDate()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{e.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(e.startAt)} – {formatDateTime(e.endAt)}
                  </p>
                  {e.location ? (
                    <p className="text-xs text-muted-foreground">{e.location}</p>
                  ) : null}
                </div>
                <Badge variant={e.source === "google" ? "info" : "secondary"}>
                  {e.source}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete event"
                  onClick={async () => {
                    try {
                      await removeEvent({ workspaceId, eventId: e._id });
                      toast({ title: "Event deleted", variant: "success" });
                    } catch (err) {
                      toast({
                        title: "Could not delete event",
                        description:
                          err instanceof Error ? err.message : undefined,
                        variant: "error",
                      });
                    }
                  }}
                >
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {googleConnected ? (
        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              From your Google Calendar
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshGoogle()}
              disabled={googleLoading}
            >
              {googleLoading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Refresh
            </Button>
          </div>
          {googleEvents === null ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : googleOnly.length === 0 ? (
            <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
              No other upcoming events in your Google Calendar.
            </p>
          ) : (
            <div className="space-y-2">
              {googleOnly.map((g) => {
                const startMs = g.start ? Date.parse(g.start) : NaN;
                const endMs = g.end ? Date.parse(g.end) : NaN;
                return (
                  <Card key={g.externalId}>
                    <CardContent className="flex items-center gap-3 py-3.5">
                      <div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-md border text-center">
                        <span className="text-[10px] uppercase text-muted-foreground">
                          {Number.isNaN(startMs)
                            ? "—"
                            : new Date(startMs).toLocaleString(undefined, {
                                month: "short",
                              })}
                        </span>
                        <span className="text-sm font-semibold leading-none">
                          {Number.isNaN(startMs)
                            ? ""
                            : new Date(startMs).getDate()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {g.title ?? "(no title)"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {Number.isNaN(startMs) ? "—" : formatDateTime(startMs)}
                          {!Number.isNaN(endMs)
                            ? ` – ${formatDateTime(endMs)}`
                            : ""}
                        </p>
                      </div>
                      <Badge variant="info">google</Badge>
                      {g.htmlLink ? (
                        <a
                          href={g.htmlLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Open in Google Calendar"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <NewEventDialog
        open={open}
        onOpenChange={setOpen}
        workspaceId={workspaceId}
      />
    </div>
  );
}

function NewEventDialog({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workspaceId: Id<"workspaces">;
}) {
  const createEvent = useAction(api.calendar.createEvent);
  const { toast } = useToast();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [startAt, setStartAt] = React.useState("");
  const [endAt, setEndAt] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !startAt) {
      toast({ title: "Title and start time are required", variant: "error" });
      return;
    }
    const start = new Date(startAt).getTime();
    const end = endAt ? new Date(endAt).getTime() : start + 60 * 60 * 1000;
    setSubmitting(true);
    try {
      const res = await createEvent({
        workspaceId,
        title: title.trim(),
        description: description.trim() || undefined,
        startAt: start,
        endAt: end,
        location: location.trim() || undefined,
      });
      toast({
        title: "Event created",
        description: res.mirroredToGoogle
          ? "Also added to Google Calendar."
          : "Stored in the internal calendar.",
        variant: "success",
      });
      setTitle("");
      setDescription("");
      setStartAt("");
      setEndAt("");
      setLocation("");
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not create event",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader title="New event" />
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="e-title">Title</Label>
          <Input
            id="e-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="e-start">Start</Label>
            <Input
              id="e-start"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-end">End</Label>
            <Input
              id="e-end"
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e-loc">Location</Label>
          <Input
            id="e-loc"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e-desc">Description</Label>
          <Textarea
            id="e-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
