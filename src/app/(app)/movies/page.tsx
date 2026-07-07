"use client";

import * as React from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Film, Loader2, Ticket, RefreshCw, ExternalLink, Star } from "lucide-react";
import { PageHeader, EmptyState, RequireWorkspace } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { preopenTab, navigateNoReferrer, closeTab } from "@/lib/open-external";

export default function MoviesPage() {
  return (
    <RequireWorkspace>{(id) => <Movies workspaceId={id} />}</RequireWorkspace>
  );
}

type Movie = {
  title: string;
  releaseDate?: string;
  language?: string;
  rating?: number;
  overview?: string;
};

type NowPlaying = {
  source?: string;
  movies?: Movie[];
  answer?: string;
  sources?: { title?: string; url: string }[];
  error?: string;
};

const LANG: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  ml: "Malayalam",
  kn: "Kannada",
  mr: "Marathi",
  bn: "Bengali",
  pa: "Punjabi",
};

function Movies({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const nowPlaying = useAction(api.movies.nowPlaying);
  const getBookingLink = useAction(api.movies.bookingLink);
  const me = useQuery(api.users.me);
  const { toast } = useToast();

  const [data, setData] = React.useState<NowPlaying | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [bookingTitle, setBookingTitle] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = (await nowPlaying({ workspaceId })) as NowPlaying;
      setData(res);
    } catch {
      setData({ error: "Could not load movies right now." });
    } finally {
      setLoading(false);
    }
  }, [nowPlaying, workspaceId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function book(title: string) {
    if (bookingTitle) return;
    setBookingTitle(title);
    // Open a placeholder tab within the click so pop-up blockers don't stop it.
    const pre = preopenTab();
    try {
      const { url } = await getBookingLink({
        workspaceId,
        title,
        city: me?.city ?? undefined,
      });
      if (url) {
        navigateNoReferrer(pre, url); // no Referer → not flagged as bot traffic
      } else {
        closeTab(pre);
        toast({ title: "Couldn't find a booking page", variant: "error" });
      }
    } catch {
      closeTab(pre);
      toast({ title: "Couldn't open the booking page", variant: "error" });
    } finally {
      setBookingTitle(null);
    }
  }

  const movies = data?.movies ?? [];

  return (
    <div>
      <PageHeader
        title="In cinemas now"
        description={
          me?.city
            ? `Currently playing — tap Book to open BookMyShow for ${me.city}.`
            : "Currently playing in theatres. Tap Book to open BookMyShow."
        }
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : data?.error ? (
        <EmptyState
          icon={Film}
          title="Couldn't load movies"
          description={data.error}
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : movies.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {movies.map((m, i) => (
            <Card key={`${m.title}-${i}`} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-2 pt-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-tight">{m.title}</h3>
                  {typeof m.rating === "number" && m.rating > 0 ? (
                    <Badge variant="secondary" className="shrink-0 gap-1">
                      <Star className="size-3" />
                      {m.rating.toFixed(1)}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  {m.language ? (
                    <span>{LANG[m.language] ?? m.language.toUpperCase()}</span>
                  ) : null}
                  {m.releaseDate ? <span>· {m.releaseDate}</span> : null}
                </div>
                {m.overview ? (
                  <p className="line-clamp-3 text-sm text-muted-foreground">
                    {m.overview}
                  </p>
                ) : null}
                <div className="mt-auto pt-2">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => void book(m.title)}
                    disabled={bookingTitle === m.title}
                  >
                    {bookingTitle === m.title ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Ticket />
                    )}
                    Book on BookMyShow
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data?.answer ? (
        // Web-search fallback (no TMDB key): show the synthesized list + sources.
        <Card>
          <CardContent className="space-y-3 pt-5">
            <p className="whitespace-pre-wrap text-sm">{data.answer}</p>
            {data.sources && data.sources.length > 0 ? (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {data.sources.slice(0, 5).map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {s.title ?? new URL(s.url).hostname} <ExternalLink className="size-3" />
                  </a>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={Film}
          title="No listings right now"
          description="Try refreshing in a bit."
          action={<Button onClick={() => void load()}>Refresh</Button>}
        />
      )}
    </div>
  );
}
