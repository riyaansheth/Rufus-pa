"use client";

import * as React from "react";
import { Download, X, Share } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * "Add to home screen" prompt. On Chrome/Edge/Android it triggers the native
 * install flow; on iOS Safari (no beforeinstallprompt) it shows the manual
 * Share → Add to Home Screen hint. Hidden once installed (standalone) or
 * dismissed for the session.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] =
    React.useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [standalone, setStandalone] = React.useState(true);

  React.useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true;
    setStandalone(isStandalone);
    setDismissed(sessionStorage.getItem("rufuspa.installDismissed") === "1");

    const ua = window.navigator.userAgent;
    setIsIOS(/iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua));

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => setStandalone(true);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone || dismissed) return null;
  // Nothing to show if neither a native prompt is available nor iOS.
  if (!deferred && !isIOS) return null;

  function close() {
    setDismissed(true);
    sessionStorage.setItem("rufuspa.installDismissed", "1");
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    close();
  }

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border bg-primary/5 px-4 py-3 text-sm">
      <Download className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        {isIOS && !deferred ? (
          <p className="text-muted-foreground">
            Install Rufuspa: tap <Share className="inline size-3.5" /> Share, then
            <span className="font-medium text-foreground">
              {" "}
              Add to Home Screen
            </span>
            .
          </p>
        ) : (
          <p className="text-muted-foreground">
            Install Rufuspa on your device for quick, app-like access.
          </p>
        )}
      </div>
      {deferred ? (
        <Button size="sm" onClick={install}>
          Install
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        onClick={close}
        aria-label="Dismiss"
        className="shrink-0"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
