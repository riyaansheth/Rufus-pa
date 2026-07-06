"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace-provider";
import { NAV, ADMIN_NAV, NavLink } from "@/components/app-sidebar";

/**
 * Mobile navigation. The desktop sidebar is hidden below `md`, so on phones a
 * hamburger opens this slide-over drawer with the same nav. Closes on route
 * change, backdrop tap, or the close button.
 */
export function MobileNav() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const { role } = useWorkspace();
  const isAdmin = role === "owner" || role === "admin";

  // Close whenever the route changes (a link was tapped).
  React.useEffect(() => setOpen(false), [pathname]);

  // Lock body scroll while the drawer is open.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
      >
        <Menu />
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[82%] flex-col border-r bg-card shadow-xl">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <div className="flex items-center gap-2">
                <Logo size={22} />
                <span className="font-semibold tracking-tight">Rufuspa</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
              >
                <X />
              </Button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {NAV.map((item) => (
                <NavLink
                  key={item.href}
                  {...item}
                  pathname={pathname}
                  onNavigate={() => setOpen(false)}
                />
              ))}
              {isAdmin ? (
                <>
                  <div className="px-3 pb-1 pt-4 text-xs font-medium uppercase text-muted-foreground">
                    Admin
                  </div>
                  {ADMIN_NAV.map((item) => (
                    <NavLink
                      key={item.href}
                      {...item}
                      pathname={pathname}
                      onNavigate={() => setOpen(false)}
                    />
                  ))}
                </>
              ) : null}
            </nav>
          </aside>
        </div>
      ) : null}
    </>
  );
}
