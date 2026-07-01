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
} from "lucide-react";
import { PageHeader, RequireWorkspace } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useVoiceRecorder } from "@/components/use-voice-recorder";

const SUGGESTIONS = [
  "What do I have today?",
  "Schedule a meeting with Rahul tomorrow at 4 PM.",
  "Remind me to review the vendor proposal on Friday morning.",
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
  const { toast } = useToast();
  const sendMessage = useAction(api.assistant.sendMessage);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const messages = useQuery(
    api.assistantData.listMessages,
    conversationId ? { workspaceId, conversationId } : "skip",
  );

  const {
    recording,
    busy: transcribing,
    toggle: toggleRecording,
  } = useVoiceRecorder({
    onTranscript: (text) => setInput((prev) => (prev ? prev + " " : "") + text),
    onError: (msg) => toast({ title: "Voice input failed", description: msg, variant: "error" }),
  });

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function handleSend(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);
    try {
      const res = await sendMessage({
        workspaceId,
        conversationId: conversationId ?? undefined,
        content,
      });
      setConversationId(res.conversationId);
    } catch (err) {
      toast({
        title: "Assistant error",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      });
      setInput(content);
    } finally {
      setSending(false);
    }
  }

  const isEmpty = !conversationId || (messages && messages.length === 0);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader
        title="Assistant"
        description="Talk or type. It creates tasks, reminders, events, monitors, and approval requests."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              setConversationId(null);
              setInput("");
            }}
          >
            <Plus /> New chat
          </Button>
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
            messages?.map((m) => <MessageBubble key={m._id} message={m} />)
          )}
          {sending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Thinking…
            </div>
          ) : null}
        </div>

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
              variant={recording ? "destructive" : "outline"}
              size="icon"
              onClick={toggleRecording}
              disabled={transcribing}
              aria-label="Voice input"
              title="Voice input (browser microphone)"
            >
              {transcribing ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Mic className={recording ? "animate-pulse" : undefined} />
              )}
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
