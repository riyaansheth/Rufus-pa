"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { Loader2, Mic } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { useVoiceRecorder } from "@/components/use-voice-recorder";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { navigateNoReferrer } from "@/lib/open-external";

/**
 * Global voice command button (app header). From ANY page: tap, speak, done —
 * the command goes straight to the assistant, which acts and replies via toast
 * (and out loud, when "speak replies" is enabled on the assistant page).
 */
export function QuickCapture() {
  const { activeWorkspaceId } = useWorkspace();
  const sendMessage = useAction(api.assistant.sendMessage);
  const { toast } = useToast();
  const [working, setWorking] = React.useState(false);

  const workspaceIdRef = React.useRef(activeWorkspaceId);
  workspaceIdRef.current = activeWorkspaceId;

  const { recording, busy, toggle } = useVoiceRecorder({
    onTranscript: async (text) => {
      const workspaceId = workspaceIdRef.current;
      if (!workspaceId) return;
      setWorking(true);
      try {
        const res = await sendMessage({
          workspaceId,
          content: text,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        toast({ title: "Assistant", description: res.reply, variant: "success" });
        // "Book now" → open the provider page (human completes checkout).
        // No-referrer so BookMyShow's Cloudflare doesn't flag it as bot traffic.
        if (res.openUrl) navigateNoReferrer(null, res.openUrl);
        if (window.localStorage.getItem("rufuspa.speakReplies") === "1") {
          void speakOnce(res.reply);
        }
      } catch (err) {
        toast({
          title: "Assistant error",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      } finally {
        setWorking(false);
      }
    },
    onError: (msg) =>
      toast({ title: "Voice input failed", description: msg, variant: "error" }),
  });

  if (!activeWorkspaceId) return null;

  return (
    <Button
      variant={recording ? "destructive" : "ghost"}
      size="icon"
      onClick={toggle}
      disabled={busy || working}
      aria-label="Voice command"
      title="Voice command — speak from anywhere, the assistant handles it"
    >
      {busy || working ? (
        <Loader2 className="size-5 animate-spin" />
      ) : (
        <Mic className={recording ? "size-5 animate-pulse" : "size-5"} />
      )}
    </Button>
  );
}

/** Fire-and-forget TTS for quick-capture replies. */
async function speakOnce(text: string) {
  try {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => URL.revokeObjectURL(url);
    void audio.play().catch(() => URL.revokeObjectURL(url));
  } catch {
    // best-effort
  }
}
