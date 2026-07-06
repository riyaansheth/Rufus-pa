"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Radar, Plus, Loader2, Pause, Play, Trash2 } from "lucide-react";
import { PageHeader, EmptyState, RequireWorkspace } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatRelative } from "@/lib/utils";

type MonitorType = "product" | "movie_ticket" | "event" | "generic_url";
type MonitorStatus = "active" | "paused" | "completed" | "failed";

const statusVariant: Record<MonitorStatus, "success" | "secondary" | "info" | "destructive"> = {
  active: "success",
  paused: "secondary",
  completed: "info",
  failed: "destructive",
};

export default function MonitorsPage() {
  return (
    <RequireWorkspace>{(id) => <Monitors workspaceId={id} />}</RequireWorkspace>
  );
}

function Monitors({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const [open, setOpen] = React.useState(false);
  const monitors = useQuery(api.monitors.list, { workspaceId });
  const setStatusFn = useMutation(api.monitors.setStatus);
  const removeFn = useMutation(api.monitors.remove);
  const { toast } = useToast();

  // Deleting a monitor is irreversible, so confirm it (and disable while in flight).
  const [pendingDelete, setPendingDelete] = React.useState<{
    id: Id<"monitors">;
    title: string;
  } | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const withError = <T,>(p: Promise<T>) =>
    p.catch((err) =>
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      }),
    );
  const setStatus = (args: Parameters<typeof setStatusFn>[0]) =>
    withError(setStatusFn(args));

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await removeFn({ workspaceId, monitorId: pendingDelete.id });
      toast({ title: "Monitor deleted", variant: "success" });
      setPendingDelete(null);
    } catch (err) {
      toast({
        title: "Could not delete monitor",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Monitors"
        description="Track products, tickets, and events. Monitors alert you — they never complete checkout."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New monitor
          </Button>
        }
      />

      <Card className="mb-4 bg-muted/30">
        <CardContent className="pt-5 text-sm text-muted-foreground">
          The MVP uses a manual monitor provider — no scraping or automated browsing.
          When a condition is met (via a future Browserbase/Browserless connector), an
          approval request is prepared for a human to complete.
        </CardContent>
      </Card>

      {monitors === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : monitors.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="No monitors yet"
          description="Ask the assistant: 'Track this product and alert me if the price drops below ₹5000.'"
          action={<Button onClick={() => setOpen(true)}>New monitor</Button>}
        />
      ) : (
        <div className="space-y-2">
          {monitors.map((m) => (
            <Card key={m._id}>
              <CardContent className="flex items-center gap-3 py-3.5">
                <Radar className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{m.title}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {m.type.replace(/_/g, " ")}
                    {m.url ? (
                      <>
                        {" · "}
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 underline"
                        >
                          link ↗
                        </a>
                      </>
                    ) : null}
                    {m.lastCheckedAt
                      ? ` · checked ${formatRelative(m.lastCheckedAt)}`
                      : " · not checked yet"}
                  </p>
                  {m.lastResult &&
                  typeof m.lastResult === "object" &&
                  "note" in (m.lastResult as Record<string, unknown>) ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {String((m.lastResult as { note: string }).note)}
                    </p>
                  ) : null}
                </div>
                <Badge variant={statusVariant[m.status as MonitorStatus]}>
                  {m.status}
                </Badge>
                {m.status === "active" || m.status === "paused" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={m.status === "active" ? "Pause" : "Resume"}
                    onClick={() =>
                      setStatus({
                        workspaceId,
                        monitorId: m._id,
                        status: m.status === "active" ? "paused" : "active",
                      })
                    }
                  >
                    {m.status === "active" ? (
                      <Pause className="text-muted-foreground" />
                    ) : (
                      <Play className="text-muted-foreground" />
                    )}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete monitor"
                  onClick={() =>
                    setPendingDelete({ id: m._id, title: m.title })
                  }
                >
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewMonitorDialog
        open={open}
        onOpenChange={setOpen}
        workspaceId={workspaceId}
      />

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && !deleting && setPendingDelete(null)}
      >
        <DialogHeader title="Delete monitor?" />
        <p className="text-sm text-muted-foreground">
          This stops tracking
          {pendingDelete ? ` “${pendingDelete.title}”` : " this monitor"} and
          can&apos;t be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setPendingDelete(null)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={confirmDelete}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function NewMonitorDialog({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workspaceId: Id<"workspaces">;
}) {
  const create = useMutation(api.monitors.create);
  const { toast } = useToast();
  const [type, setType] = React.useState<MonitorType>("product");
  const [title, setTitle] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [priceBelow, setPriceBelow] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await create({
        workspaceId,
        type,
        title: title.trim(),
        url: url.trim() || undefined,
        conditions: priceBelow
          ? { priceBelow: Number(priceBelow), currency: "INR" }
          : undefined,
      });
      toast({ title: "Monitor created", variant: "success" });
      setTitle("");
      setUrl("");
      setPriceBelow("");
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not create monitor",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader title="New monitor" />
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="m-type">Type</Label>
            <Select
              id="m-type"
              value={type}
              onChange={(e) => setType(e.target.value as MonitorType)}
            >
              <option value="product">Product</option>
              <option value="movie_ticket">Movie ticket</option>
              <option value="event">Event</option>
              <option value="generic_url">Generic URL</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-price">Alert if price below (₹)</Label>
            <Input
              id="m-price"
              type="number"
              value={priceBelow}
              onChange={(e) => setPriceBelow(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-title">Title</Label>
          <Input
            id="m-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-url">URL</Label>
          <Input
            id="m-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
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
