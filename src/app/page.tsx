import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  ShieldCheck,
  CalendarClock,
  Radar,
  ScrollText,
  Sparkles,
  Lock,
} from "lucide-react";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-primary" /> Rufuspa
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/sign-in" className="hover:underline">
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90"
          >
            Get started
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
          <Lock className="size-3" /> Supervised assistant — human approval for every
          sensitive action
        </div>
        <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          The AI executive assistant for teams
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-muted-foreground">
          Manage calendar, reminders, task tracking, and availability monitoring, and
          prepare purchase requests — with human approval and full audit logs. It never
          completes payments, OTPs, or checkouts on its own.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/sign-up"
            className="rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground hover:bg-primary/90"
          >
            Create your workspace
          </Link>
          <Link
            href="/sign-in"
            className="rounded-md border px-6 py-3 font-medium hover:bg-accent"
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: Sparkles,
            title: "AI assistant",
            body: "Talk or type. It schedules, reminds, tracks tasks, and prepares requests.",
          },
          {
            icon: CalendarClock,
            title: "Calendar & reminders",
            body: "Google Calendar integration with an internal fallback.",
          },
          {
            icon: Radar,
            title: "Availability monitors",
            body: "Track products, tickets, and events — alerts, never silent checkout.",
          },
          {
            icon: ScrollText,
            title: "Approvals & audit",
            body: "Every sensitive action needs approval and is logged.",
          },
        ].map((f) => (
          <div key={f.title} className="rounded-xl border p-5">
            <f.icon className="size-5 text-primary" />
            <h3 className="mt-3 font-medium">{f.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
