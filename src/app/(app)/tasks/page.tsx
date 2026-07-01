"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CheckSquare, Plus, Trash2, Loader2 } from "lucide-react";
import { PageHeader, EmptyState, RequireWorkspace } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";
type Priority = "low" | "medium" | "high";

const priorityVariant: Record<Priority, "secondary" | "warning" | "destructive"> = {
  low: "secondary",
  medium: "warning",
  high: "destructive",
};

export default function TasksPage() {
  return (
    <RequireWorkspace>{(id) => <Tasks workspaceId={id} />}</RequireWorkspace>
  );
}

function Tasks({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const [open, setOpen] = React.useState(false);
  const tasks = useQuery(api.tasks.list, { workspaceId });
  const update = useMutation(api.tasks.update);
  const remove = useMutation(api.tasks.remove);
  const { toast } = useToast();

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Track work across your team. The assistant can create these too."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New task
          </Button>
        }
      />

      {tasks === undefined ? (
        <TaskSkeleton />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks yet"
          description="Create your first task, or ask the assistant to add one."
          action={<Button onClick={() => setOpen(true)}>New task</Button>}
        />
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <Card key={t._id}>
              <CardContent className="flex items-center gap-3 py-3.5">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={t.status === "done"}
                  onChange={(e) =>
                    update({
                      workspaceId,
                      taskId: t._id,
                      status: e.target.checked ? "done" : "todo",
                    })
                  }
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={
                      t.status === "done"
                        ? "text-sm font-medium line-through text-muted-foreground"
                        : "text-sm font-medium"
                    }
                  >
                    {t.title}
                  </p>
                  {t.description ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {t.description}
                    </p>
                  ) : null}
                  {t.dueAt ? (
                    <p className="text-xs text-muted-foreground">
                      Due {formatDateTime(t.dueAt)}
                    </p>
                  ) : null}
                </div>
                <Badge variant={priorityVariant[t.priority as Priority]}>
                  {t.priority}
                </Badge>
                <Select
                  className="w-32"
                  value={t.status}
                  onChange={(e) =>
                    update({
                      workspaceId,
                      taskId: t._id,
                      status: e.target.value as TaskStatus,
                    })
                  }
                >
                  <option value="todo">To do</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    await remove({ workspaceId, taskId: t._id });
                    toast({ title: "Task deleted", variant: "success" });
                  }}
                  aria-label="Delete task"
                >
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewTaskDialog
        open={open}
        onOpenChange={setOpen}
        workspaceId={workspaceId}
      />
    </div>
  );
}

function NewTaskDialog({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workspaceId: Id<"workspaces">;
}) {
  const create = useMutation(api.tasks.create);
  const { toast } = useToast();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState<Priority>("medium");
  const [dueAt, setDueAt] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await create({
        workspaceId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        dueAt: dueAt ? new Date(dueAt).getTime() : undefined,
      });
      toast({ title: "Task created", variant: "success" });
      setTitle("");
      setDescription("");
      setDueAt("");
      setPriority("medium");
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not create task",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader title="New task" />
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="t-title">Title</Label>
          <Input
            id="t-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-desc">Description</Label>
          <Textarea
            id="t-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="t-priority">Priority</Label>
            <Select
              id="t-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-due">Due</Label>
            <Input
              id="t-due"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
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

function TaskSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
