"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Sparkles,
  CheckSquare,
  BellRing,
  Calendar,
  Radar,
  ShieldCheck,
  Settings,
  ScrollText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { useWorkspace } from "@/components/workspace-provider";

export const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/assistant", label: "Assistant", icon: Sparkles },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/reminders", label: "Reminders", icon: BellRing },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/monitors", label: "Monitors", icon: Radar },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

export const ADMIN_NAV = [
  { href: "/admin/audit-logs", label: "Audit Logs", icon: ScrollText },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { role } = useWorkspace();
  const isAdmin = role === "owner" || role === "admin";

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-card/40 md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-5">
        <Logo size={22} />
        <span className="font-semibold tracking-tight">Rufuspa</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV.map((item) => (
          <NavLink key={item.href} {...item} pathname={pathname} />
        ))}
        {isAdmin ? (
          <>
            <div className="px-3 pb-1 pt-4 text-xs font-medium uppercase text-muted-foreground">
              Admin
            </div>
            {ADMIN_NAV.map((item) => (
              <NavLink key={item.href} {...item} pathname={pathname} />
            ))}
          </>
        ) : null}
      </nav>
      <div className="border-t p-4 text-xs text-muted-foreground">
        Supervised assistant. Sensitive actions require human approval.
      </div>
    </aside>
  );
}

export function NavLink({
  href,
  label,
  icon: Icon,
  pathname,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}
