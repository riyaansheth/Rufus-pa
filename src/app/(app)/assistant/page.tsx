"use client";

import * as React from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Sparkles,
  Send,
  Mic,
  Loader2,
  Plus,
  ExternalLink,
  ShieldCheck,
  AudioLines,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { PageHeader, RequireWorkspace } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useVoiceRecorder } from "@/components/use-voice-recorder";

const SUGGESTIONS = [
  "What do I have today?",
  "Schedule a meeting with Rahul tomorrow at 4 PM.",
  "Remind me to review the vendor proposal on Friday morning.",
  "Mark the vendor proposal task as done.",
  "Move my meeting with Rahul to 6 PM.",
  "Track this product and alert me if the price goes below ₹5000.",
  "Prepare a purchase request for a team software subscription.",
  "Show my pending approvals.",
];

export default function AssistantPage() {
  return (
    <RequireWorkspace>{(id) => <Assistant workspaceId={id} />}</RequireWorkspace>
  );
}

function Assistant({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const [conversationId, setConversationId] =
    React.useState<Id<"assistantConversations"> | null>(null);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  // Shows the user's message immediately while the assistant is thinking (the query
  // only subscribes once we have a conversationId after the round-trip).
  const [pendingUserMessage, setPendingUserMessage] = React.useState<string | null>(
    null,
  );
  const { toast } = useToast();
  const sendMessage = useAction(api.assistant.sendMessage);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const messages = useQuery(
    api.assistantData.listMessages,
    conversationId ? { workspaceId, conversationId } : "skip",
  );
  const conversations = useQuery(api.assistantData.listConversations, {
    workspaceId,
  });

  // --- Voice conversation state ------------------------------------------
  // voiceMode = continuous hands-free loop: listen → send → speak reply → listen.
  // speakReplies = read replies aloud even outside voice mode (persisted).
  const [voiceMode, setVoiceMode] = React.useState(false);
  const voiceModeRef = React.useRef(false);
  const [speakReplies, setSpeakReplies] = React.useState(false);
  const speakRepliesRef = React.useRef(false);
  const [speaking, setSpeaking] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const discardNextTranscriptRef = React.useRef(false);
  const handleSendRef = React.useRef<(t: string) => void>(() => {});
  const startListeningRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    setSpeakReplies(window.localStorage.getItem("rufuspa.speakReplies") === "1");
  }, []);
  React.useEffect(() => {
    speakRepliesRef.current = speakReplies;
  }, [speakReplies]);
  React.useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  const {
    recording,
    busy: transcribing,
    toggle: toggleRecording,
    start: startRecording,
    stop: stopRecording,
  } = useVoiceRecorder({
    // Hands-free: a finished utterance sends itself — no send button needed.
    onTranscript: (text) => {
      if (discardNextTranscriptRef.current) {
        discardNextTranscriptRef.current = false;
        return;
      }
      handleSendRef.current(text);
    },
    onError: (msg) => {
      setVoiceMode(false);
      voiceModeRef.current = false;
      toast({ title: "Voice input failed", description: msg, variant: "error" });
    },
  });
  startListeningRef.current = () => void startRecording();

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeaking(false);
  }

  /** Speak `text` via /api/speak; resolves when playback finishes. */
  async function speak(text: string): Promise<void> {
    stopAudio();
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok || !res.body) return; // TTS is best-effort; the text is on screen
      setSpeaking(true);
      // Prefer streaming playback (starts before the whole clip is synthesized).
      const canStream =
        typeof MediaSource !== "undefined" &&
        typeof MediaSource.isTypeSupported === "function" &&
        MediaSource.isTypeSupported("audio/mpeg");
      if (canStream) {
        await playStream(res.body);
      } else {
        const url = URL.createObjectURL(await res.blob());
        await playUrl(url, () => URL.revokeObjectURL(url));
      }
    } catch {
      setSpeaking(false);
    }
  }

  /** Play a finished object URL, resolving when playback ends/stops. */
  function playUrl(url: string, onDone?: () => void): Promise<void> {
    return new Promise<void>((resolve) => {
      const audio = new Audio(url);
      audioRef.current = audio;
      const done = () => {
        onDone?.();
        setSpeaking(false);
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = done;
      void audio.play().catch(done);
    });
  }

  /**
   * Low-latency playback: feed the streamed MP3 into a MediaSource so audio
   * starts within a chunk or two instead of waiting for the full synthesis.
   */
  function playStream(body: ReadableStream<Uint8Array>): Promise<void> {
    return new Promise<void>((resolve) => {
      const mediaSource = new MediaSource();
      const url = URL.createObjectURL(mediaSource);
      const audio = new Audio();
      audio.src = url;
      audioRef.current = audio;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        setSpeaking(false);
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.onpause = done; // stopAudio() pauses → resolves
      mediaSource.addEventListener("sourceopen", () => {
        let sb: SourceBuffer;
        try {
          sb = mediaSource.addSourceBuffer("audio/mpeg");
        } catch {
          done();
          return;
        }
        const queue: Uint8Array[] = [];
        let reading = true;
        const flush = () => {
          if (sb.updating || queue.length === 0) return;
          try {
            sb.appendBuffer(queue.shift()! as BufferSource);
          } catch {
            /* buffer full or closed — ignore, playback continues */
          }
        };
        sb.addEventListener("updateend", () => {
          flush();
          if (!reading && !sb.updating && queue.length === 0) {
            try {
              if (mediaSource.readyState === "open") mediaSource.endOfStream();
            } catch {
              /* already ended */
            }
          }
        });
        const reader = body.getReader();
        const pump = async () => {
          try {
            for (;;) {
              // Abandon the stream if playback was stopped/replaced.
              if (audioRef.current !== audio) {
                reader.cancel().catch(() => {});
                return;
              }
              const { done: rdone, value } = await reader.read();
              if (rdone) break;
              if (value) {
                queue.push(value);
                flush();
              }
            }
          } catch {
            /* stream error — end with whatever we have */
          } finally {
            reading = false;
            if (!sb.updating && queue.length === 0) {
              try {
                if (mediaSource.readyState === "open") mediaSource.endOfStream();
              } catch {
                /* already ended */
              }
            }
          }
        };
        void pump();
      });
      void audio.play().catch(done);
    });
  }

  function enterVoiceMode() {
    stopAudio();
    setVoiceMode(true);
    voiceModeRef.current = true;
    void startRecording();
  }

  function exitVoiceMode() {
    setVoiceMode(false);
    voiceModeRef.current = false;
    if (recording) {
      // Whatever is mid-recording shouldn't fire off a message after exit.
      discardNextTranscriptRef.current = true;
      stopRecording();
    }
    stopAudio();
  }

  // Escape exits voice mode.
  React.useEffect(() => {
    if (!voiceMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitVoiceMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode, recording]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Retire the optimistic bubble once the persisted copy is in the live query.
  React.useEffect(() => {
    if (!pendingUserMessage || !messages) return;
    if (
      messages.some(
        (m) => m.role === "user" && m.content === pendingUserMessage,
      )
    ) {
      setPendingUserMessage(null);
    }
  }, [messages, pendingUserMessage]);

  // Never render the optimistic bubble alongside its persisted twin (the query
  // can deliver the message one frame before the effect above clears it).
  const showPendingBubble =
    pendingUserMessage !== null &&
    !(messages ?? []).some(
      (m) => m.role === "user" && m.content === pendingUserMessage,
    );

  async function handleSend(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    stopAudio(); // never talk over a new command (also avoids TTS feeding the mic)
    setInput("");
    setPendingUserMessage(content);
    setSending(true);
    let reply: string | null = null;
    try {
      const res = await sendMessage({
        workspaceId,
        conversationId: conversationId ?? undefined,
        content,
        // Resolve "tomorrow at 4pm" in the user's actual timezone, not the UTC server.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setConversationId(res.conversationId);
      reply = res.reply;
    } catch (err) {
      toast({
        title: "Assistant error",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
      setInput(content);
      setPendingUserMessage(null); // failed → restore input, drop the bubble
    } finally {
      setSending(false);
      // On success the pending bubble is NOT cleared here — it stays until the
      // persisted message arrives in the live query (see effect below), so the
      // chat never flashes blank while the new conversation's query loads.
    }
    if (reply && (speakRepliesRef.current || voiceModeRef.current)) {
      await speak(reply);
    }
    // Hands-free loop: after the (spoken) reply, listen for the next command.
    if (reply !== null && voiceModeRef.current) {
      startListeningRef.current();
    }
  }
  handleSendRef.current = handleSend;

  const isEmpty =
    !pendingUserMessage &&
    (!conversationId || (messages && messages.length === 0));

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader
        title="Assistant"
        description="Talk or type. It creates tasks, reminders, events, monitors, and approval requests."
        actions={
          <div className="flex items-center gap-2">
            {conversations && conversations.length > 0 ? (
              <Select
                className="w-52"
                value={conversationId ?? ""}
                onChange={(e) =>
                  setConversationId(
                    (e.target.value || null) as typeof conversationId,
                  )
                }
              >
                <option value="">Current chat</option>
                {conversations.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button
              variant="outline"
              onClick={() => {
                setConversationId(null);
                setInput("");
              }}
            >
              <Plus /> New chat
            </Button>
          </div>
        }
      />

      <Card className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
          {isEmpty ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="size-6 text-primary" />
              </div>
              <p className="font-medium">How can I help?</p>
              <p className="mb-5 mt-1 max-w-md text-sm text-muted-foreground">
                I schedule, remind, track, and prepare requests. I never complete
                payments, OTPs, or checkouts — those need your approval.
              </p>
              <div className="flex max-w-xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages?.map((m) => <MessageBubble key={m._id} message={m} />)}
              {showPendingBubble ? (
                <MessageBubble
                  message={{ role: "user", content: pendingUserMessage! }}
                />
              ) : null}
            </>
          )}
          {sending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Thinking…
            </div>
          ) : null}
        </div>

        {voiceMode ? (
          <div className="flex items-center justify-between gap-3 border-t bg-primary/5 px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "size-2.5 rounded-full",
                  recording
                    ? "animate-pulse bg-red-500"
                    : speaking
                      ? "animate-pulse bg-emerald-500"
                      : "bg-muted-foreground",
                )}
              />
              {recording
                ? "Listening — just speak, I'll detect when you're done…"
                : transcribing
                  ? "Understanding…"
                  : sending
                    ? "Working on it…"
                    : speaking
                      ? "Speaking…"
                      : "Voice conversation on"}
            </div>
            <Button variant="destructive" size="sm" onClick={exitVoiceMode}>
              <Square /> End voice mode (Esc)
            </Button>
          </div>
        ) : null}

        <div className="border-t p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(input);
            }}
            className="flex items-end gap-2"
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(input);
                }
              }}
              placeholder="Message the assistant…  (Enter to send, Shift+Enter for newline)"
              className="min-h-[44px] flex-1 resize-none"
              rows={1}
            />
            <Button
              type="button"
              variant={speakReplies ? "secondary" : "ghost"}
              size="icon"
              onClick={() => {
                const next = !speakReplies;
                setSpeakReplies(next);
                window.localStorage.setItem("rufuspa.speakReplies", next ? "1" : "0");
                if (!next) stopAudio();
              }}
              aria-label={speakReplies ? "Mute spoken replies" : "Speak replies aloud"}
              title={speakReplies ? "Spoken replies ON" : "Speak replies aloud"}
            >
              {speakReplies ? <Volume2 /> : <VolumeX />}
            </Button>
            <Button
              type="button"
              variant={recording && !voiceMode ? "destructive" : "outline"}
              size="icon"
              onClick={toggleRecording}
              disabled={transcribing || voiceMode}
              aria-label="Voice input (one command)"
              title="Speak one command — it sends automatically"
            >
              {transcribing ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Mic className={recording ? "animate-pulse" : undefined} />
              )}
            </Button>
            <Button
              type="button"
              variant={voiceMode ? "destructive" : "default"}
              onClick={voiceMode ? exitVoiceMode : enterVoiceMode}
              title="Continuous voice conversation — it listens, acts, and talks back"
            >
              <AudioLines className={voiceMode ? "animate-pulse" : undefined} />
              {voiceMode ? "Stop" : "Voice"}
            </Button>
            <Button type="submit" size="icon" disabled={sending || !input.trim()}>
              <Send />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}

type Action = {
  kind: string;
  label: string;
  href?: string;
};

function MessageBubble({
  message,
}: {
  message: {
    role: string;
    content: string;
    actions?: Action[];
  };
}) {
  const isUser = message.role === "user";
  if (message.role === "tool" || message.role === "system") return null;
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-2", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground",
          )}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        {message.actions && message.actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {message.actions.map((a, i) => (
              <ActionCard key={i} action={a} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActionCard({ action }: { action: Action }) {
  const isApproval = action.kind === "approval_requested";
  const body = (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
        isApproval && "border-amber-300 bg-amber-50/60 dark:bg-amber-900/10",
      )}
    >
      {isApproval ? (
        <ShieldCheck className="size-4 text-amber-600" />
      ) : (
        <Sparkles className="size-4 text-primary" />
      )}
      <span className="font-medium">{action.label}</span>
      {action.href ? <ExternalLink className="size-3 text-muted-foreground" /> : null}
    </div>
  );
  return action.href ? <Link href={action.href}>{body}</Link> : body;
}
