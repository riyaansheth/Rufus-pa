"use client";

import * as React from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Calendar as CalendarIcon,
  Plus,
  Loader2,
  Trash2,
  ExternalLink,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { PageHeader, RequireWorkspace } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, cn } from "@/lib/utils";

export default function CalendarPage() {
  return (
    <RequireWorkspace>{(id) => <CalendarView workspaceId={id} />}</RequireWorkspace>
  );
}

// A single event, unified across the internal calendar and Google Calendar.
type UnifiedEvent = {
  key: string;
  title: string;
  startMs: number;
  endMs?: number;
  allDay: boolean;
  source: "internal" | "google";
  location?: string;
  htmlLink?: string;
  internalId?: Id<"calendarEvents">;
};

type GoogleEvent = {
  externalId: string;
  title?: string;
  start?: string;
  end?: string;
  htmlLink?: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Parse a Google start/end string. Date-only strings ("2026-07-06") are all-day. */
function parseGoogleTime(s?: string): { ms: number; allDay: boolean } | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return { ms: new Date(y, m - 1, d).getTime(), allDay: true };
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : { ms, allDay: false };
}

/** Local Y-M-D bucket key for a timestamp. */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Format a Date as the value a datetime-local input expects. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function CalendarView({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const today = new Date();
  const [viewYear, setViewYear] = React.useState(today.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(today.getMonth()); // 0-11
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [prefillDate, setPrefillDate] = React.useState<Date | null>(null);
  const [selected, setSelected] = React.useState<UnifiedEvent | null>(null);

  const connections = useQuery(api.calendarConnections.status, { workspaceId });
  const listGoogle = useAction(api.googleCalendar.listGoogleEvents);
  const removeEvent = useMutation(api.calendar.remove);
  const { toast } = useToast();
  const googleConnected = connections?.some(
    (c) => c.provider === "google" && c.status === "connected",
  );

  // The visible 6-week grid always starts on the Sunday on/before the 1st.
  const { days, gridStartMs, gridEndMs } = React.useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startWeekday = first.getDay();
    const cells = Array.from(
      { length: 42 },
      (_, i) => new Date(viewYear, viewMonth, 1 - startWeekday + i),
    );
    return {
      days: cells,
      gridStartMs: cells[0].getTime(),
      gridEndMs: new Date(
        viewYear,
        viewMonth,
        1 - startWeekday + 42,
      ).getTime(),
    };
  }, [viewYear, viewMonth]);

  // Internal events in the visible window (reactive).
  const internalEvents = useQuery(api.calendar.listRange, {
    workspaceId,
    from: gridStartMs,
    to: gridEndMs,
  });

  // Google events in the same window (actions aren't reactive — fetch on change).
  const [googleEvents, setGoogleEvents] = React.useState<GoogleEvent[] | null>(
    null,
  );
  const [googleLoading, setGoogleLoading] = React.useState(false);
  const refreshGoogle = React.useCallback(async () => {
    setGoogleLoading(true);
    try {
      const res = await listGoogle({
        workspaceId,
        timeMin: gridStartMs,
        timeMax: gridEndMs,
        maxResults: 250,
      });
      setGoogleEvents(res.events);
      if (res.error) {
        toast({
          title: "Google Calendar fetch failed",
          description: res.error,
          variant: "error",
        });
      }
    } catch {
      // non-fatal; internal calendar still renders
    } finally {
      setGoogleLoading(false);
    }
  }, [listGoogle, workspaceId, gridStartMs, gridEndMs, toast]);

  React.useEffect(() => {
    if (googleConnected) void refreshGoogle();
    else setGoogleEvents(null);
  }, [googleConnected, refreshGoogle]);

  // Merge internal + Google (skipping Google events already mirrored internally).
  const events: UnifiedEvent[] = React.useMemo(() => {
    const internal = internalEvents ?? [];
    const mirroredIds = new Set(
      internal.map((e) => e.externalId).filter(Boolean) as string[],
    );
    const out: UnifiedEvent[] = internal.map((e) => ({
      key: e._id,
      title: e.title,
      startMs: e.startAt,
      endMs: e.endAt,
      allDay: false,
      source: e.source === "google" ? "google" : "internal",
      location: e.location ?? undefined,
      internalId: e._id,
    }));
    for (const g of googleEvents ?? []) {
      if (g.externalId && mirroredIds.has(g.externalId)) continue;
      const start = parseGoogleTime(g.start);
      if (!start) continue;
      const end = parseGoogleTime(g.end);
      out.push({
        key: `g:${g.externalId}`,
        title: g.title ?? "(no title)",
        startMs: start.ms,
        endMs: end?.ms,
        allDay: start.allDay,
        source: "google",
        htmlLink: g.htmlLink,
      });
    }
    return out;
  }, [internalEvents, googleEvents]);

  // Bucket events by local day for O(1) lookup while rendering cells.
  const byDay = React.useMemo(() => {
    const map = new Map<string, UnifiedEvent[]>();
    for (const e of events) {
      const k = dayKey(e.startMs);
      const arr = map.get(k);
      if (arr) arr.push(e);
      else map.set(k, [e]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.startMs - b.startMs);
    return map;
  }, [events]);

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
  const todayKey = dayKey(today.getTime());
  const loading = internalEvents === undefined;

  function goToday() {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  }
  function shiftMonth(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }
  function openNewEvent(date?: Date) {
    setPrefillDate(date ?? null);
    setDialogOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="Calendar"
        description={
          googleConnected
            ? "Showing your Google Calendar — new events are mirrored there."
            : "Using the internal calendar. Connect Google Calendar to sync."
        }
        actions={
          <Button onClick={() => openNewEvent()}>
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

      {/* Month toolbar */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            Today
          </Button>
          <h2 className="ml-1 text-lg font-semibold">{monthLabel}</h2>
        </div>
        {googleConnected ? (
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
        ) : null}
      </div>

      {/* Month grid */}
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const key = dayKey(day.getTime());
            const inMonth = day.getMonth() === viewMonth;
            const isToday = key === todayKey;
            const dayEvents = byDay.get(key) ?? [];
            const shown = dayEvents.slice(0, 3);
            const overflow = dayEvents.length - shown.length;
            return (
              <div
                key={i}
                className={cn(
                  "min-h-[104px] border-b border-r p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0",
                  !inMonth && "bg-muted/20 text-muted-foreground",
                )}
                onClick={() => openNewEvent(day)}
                role="button"
                tabIndex={-1}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full text-xs",
                      isToday && "bg-primary font-semibold text-primary-foreground",
                      !isToday && !inMonth && "text-muted-foreground",
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
                <div className="space-y-1">
                  {shown.map((e) => (
                    <button
                      key={e.key}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSelected(e);
                      }}
                      className={cn(
                        "block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] leading-tight",
                        e.source === "google"
                          ? "bg-blue-500/15 text-blue-700 hover:bg-blue-500/25 dark:text-blue-300"
                          : "bg-primary/15 text-primary hover:bg-primary/25",
                      )}
                      title={e.title}
                    >
                      {!e.allDay ? (
                        <span className="tabular-nums opacity-70">
                          {new Date(e.startMs).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}{" "}
                        </span>
                      ) : null}
                      {e.title}
                    </button>
                  ))}
                  {overflow > 0 ? (
                    <span className="block px-1.5 text-[11px] text-muted-foreground">
                      +{overflow} more
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {loading ? (
        <div className="mt-3">
          <Skeleton className="h-4 w-40" />
        </div>
      ) : null}

      <EventDetailDialog
        event={selected}
        onOpenChange={(o) => !o && setSelected(null)}
        onDelete={async (e) => {
          if (!e.internalId) return;
          try {
            await removeEvent({ workspaceId, eventId: e.internalId });
            toast({ title: "Event deleted", variant: "success" });
            setSelected(null);
          } catch (err) {
            toast({
              title: "Could not delete event",
              description: err instanceof Error ? err.message : undefined,
              variant: "error",
            });
          }
        }}
      />

      <NewEventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        workspaceId={workspaceId}
        initialDate={prefillDate}
      />
    </div>
  );
}

function EventDetailDialog({
  event,
  onOpenChange,
  onDelete,
}: {
  event: UnifiedEvent | null;
  onOpenChange: (o: boolean) => void;
  onDelete: (e: UnifiedEvent) => void;
}) {
  return (
    <Dialog open={!!event} onOpenChange={onOpenChange}>
      {event ? (
        <>
          <DialogHeader title={event.title} />
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">
                {event.allDay
                  ? new Date(event.startMs).toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    }) + " · All day"
                  : `${formatDateTime(event.startMs)}${
                      event.endMs ? ` – ${formatDateTime(event.endMs)}` : ""
                    }`}
              </p>
              {event.location ? (
                <p className="mt-1 text-muted-foreground">{event.location}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={event.source === "google" ? "info" : "secondary"}>
                {event.source}
              </Badge>
              {event.htmlLink ? (
                <a
                  href={event.htmlLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  Open in Google <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {event.internalId ? (
                <Button
                  variant="destructive"
                  onClick={() => onDelete(event)}
                >
                  <Trash2 /> Delete
                </Button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

function NewEventDialog({
  open,
  onOpenChange,
  workspaceId,
  initialDate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workspaceId: Id<"workspaces">;
  initialDate: Date | null;
}) {
  const createEvent = useAction(api.calendar.createEvent);
  const { toast } = useToast();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [startAt, setStartAt] = React.useState("");
  const [endAt, setEndAt] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // When opened from a day cell, default the start to 9:00 AM that day.
  React.useEffect(() => {
    if (open && initialDate) {
      const d = new Date(initialDate);
      d.setHours(9, 0, 0, 0);
      setStartAt(toLocalInputValue(d));
    }
  }, [open, initialDate]);

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
