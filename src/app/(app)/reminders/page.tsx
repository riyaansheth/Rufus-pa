"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { BellRing, Plus, Loader2, X } from "lucide-react";
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

const statusVariant: Record<string, "info" | "success" | "secondary"> = {
  scheduled: "info",
  triggered: "success",
  cancelled: "secondary",
};

export default function RemindersPage() {
  return (
    <RequireWorkspace>{(id) => <Reminders workspaceId={id} />}</RequireWorkspace>
  );
}

function Reminders({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const [open, setOpen] = React.useState(false);
  const reminders = useQuery(api.reminders.list, { workspaceId });
  const cancelFn = useMutation(api.reminders.cancel);
  const { toast } = useToast();
  const cancel = (args: Parameters<typeof cancelFn>[0]) =>
    cancelFn(args).catch((err) =>
      toast({
        title: "Could not cancel reminder",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      }),
    );

  return (
    <div>
      <PageHeader
        title="Reminders"
        description="In-app reminders fire on schedule. Email/push delivery is planned."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New reminder
          </Button>
        }
      />

      {reminders === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : reminders.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title="No reminders yet"
          description="Create one, or ask the assistant: 'Remind me to review the proposal Friday morning.'"
          action={<Button onClick={() => setOpen(true)}>New reminder</Button>}
        />
      ) : (
        <div className="space-y-2">
          {reminders.map((r) => (
            <Card key={r._id}>
              <CardContent className="flex items-center gap-3 py-3.5">
                <BellRing className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.title}</p>
                  {r.message ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {r.message}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(r.remindAt)}
                  </p>
                </div>
                <Badge variant={statusVariant[r.status] ?? "secondary"}>
                  {r.status}
                </Badge>
                {r.status === "scheduled" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => cancel({ workspaceId, reminderId: r._id })}
                    aria-label="Cancel reminder"
                  >
                    <X className="text-muted-foreground" />
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewReminderDialog
        open={open}
        onOpenChange={setOpen}
        workspaceId={workspaceId}
      />
    </div>
  );
}

function NewReminderDialog({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workspaceId: Id<"workspaces">;
}) {
  const create = useMutation(api.reminders.create);
  const { toast } = useToast();
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [remindAt, setRemindAt] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !remindAt) {
      toast({ title: "Title and time are required", variant: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await create({
        workspaceId,
        title: title.trim(),
        message: message.trim() || undefined,
        remindAt: new Date(remindAt).getTime(),
      });
      toast({ title: "Reminder scheduled", variant: "success" });
      setTitle("");
      setMessage("");
      setRemindAt("");
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not create reminder",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader title="New reminder" />
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="r-title">Title</Label>
          <Input
            id="r-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-msg">Message</Label>
          <Textarea
            id="r-msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-time">Remind at</Label>
          <Input
            id="r-time"
            type="datetime-local"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
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
            Schedule
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
