"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  CheckSquare,
  BellRing,
  Calendar,
  ShieldCheck,
  Radar,
  ScrollText,
  ArrowRight,
} from "lucide-react";
import { PageHeader, RequireWorkspace } from "@/components/page-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatRelative } from "@/lib/utils";

export default function DashboardPage() {
  return (
    <RequireWorkspace>
      {(workspaceId) => <Dashboard workspaceId={workspaceId} />}
    </RequireWorkspace>
  );
}

function Dashboard({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const tasks = useQuery(api.tasks.listDueToday, { workspaceId });
  const reminders = useQuery(api.reminders.listUpcoming, { workspaceId, limit: 5 });
  const events = useQuery(api.calendar.listUpcoming, { workspaceId, limit: 5 });
  const approvals = useQuery(api.approvals.listPending, { workspaceId });
  const monitors = useQuery(api.monitors.list, { workspaceId, status: "active" });
  const recent = useQuery(api.auditLogs.recent, { workspaceId, limit: 8 });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Your executive assistant control center."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Today's tasks"
          value={tasks?.length}
          icon={CheckSquare}
          href="/tasks"
        />
        <StatCard
          label="Upcoming reminders"
          value={reminders?.length}
          icon={BellRing}
          href="/reminders"
        />
        <StatCard
          label="Pending approvals"
          value={approvals?.length}
          icon={ShieldCheck}
          href="/approvals"
          highlight={(approvals?.length ?? 0) > 0}
        />
        <StatCard
          label="Active monitors"
          value={monitors?.length}
          icon={Radar}
          href="/monitors"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ListCard
          title="Today's tasks"
          icon={CheckSquare}
          href="/tasks"
          empty="Nothing due today."
          loading={tasks === undefined}
          items={tasks?.map((t) => ({
            id: t._id,
            primary: t.title,
            secondary: t.dueAt ? formatDateTime(t.dueAt) : undefined,
            badge: t.priority,
          }))}
        />
        <ListCard
          title="Upcoming reminders"
          icon={BellRing}
          href="/reminders"
          empty="No upcoming reminders."
          loading={reminders === undefined}
          items={reminders?.map((r) => ({
            id: r._id,
            primary: r.title,
            secondary: formatDateTime(r.remindAt),
          }))}
        />
        <ListCard
          title="Upcoming events"
          icon={Calendar}
          href="/calendar"
          empty="No upcoming events."
          loading={events === undefined}
          items={events?.map((e) => ({
            id: e._id,
            primary: e.title,
            secondary: formatDateTime(e.startAt),
            badge: e.source === "google" ? "google" : undefined,
          }))}
        />
        <ListCard
          title="Pending approvals"
          icon={ShieldCheck}
          href="/approvals"
          empty="No pending approvals."
          loading={approvals === undefined}
          items={approvals?.map((a) => ({
            id: a._id,
            primary: a.title,
            secondary: a.amount
              ? `${a.currency ?? "INR"} ${a.amount}`
              : a.type.replace(/_/g, " "),
            badge: "pending",
          }))}
        />
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="size-4" /> Recent assistant actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent === undefined ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {recent.map((log) => (
                <li key={log._id} className="flex items-center justify-between py-2">
                  <span>
                    <span className="font-medium">
                      {log.action.replace(/[._]/g, " ")}
                    </span>
                    {log.entityType ? (
                      <span className="text-muted-foreground">
                        {" "}· {log.entityType}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelative(log.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  href,
  highlight,
}: {
  label: string;
  value: number | undefined;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Link href={href}>
      <Card className={highlight ? "border-amber-300" : undefined}>
        <CardContent className="flex items-center justify-between pt-5">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold">
              {value === undefined ? "—" : value}
            </p>
          </div>
          <Icon className="size-6 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}

type Item = {
  id: string;
  primary: string;
  secondary?: string;
  badge?: string;
};

function ListCard({
  title,
  icon: Icon,
  href,
  items,
  empty,
  loading,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  items: Item[] | undefined;
  empty: string;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4" /> {title}
        </CardTitle>
        <Link
          href={href}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          View all <ArrowRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : !items || items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{it.primary}</p>
                  {it.secondary ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {it.secondary}
                    </p>
                  ) : null}
                </div>
                {it.badge ? (
                  <Badge variant="secondary" className="ml-2 shrink-0 capitalize">
                    {it.badge}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
