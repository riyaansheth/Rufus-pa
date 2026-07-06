/**
 * Best-effort deep links that land the human as close to checkout as a link can —
 * seat selection / product page — WITHOUT any automation of the site itself.
 * The human always completes seats/payment/OTP on the provider's own site.
 *
 * These are search-style URLs (stable, ToS-friendly); exact showtime URLs would
 * require provider-internal IDs we don't scrape.
 */

export type DeepLinkKind = "product" | "movie_ticket" | "event" | "generic_url";

export function buildDeepLink(args: {
  kind: DeepLinkKind;
  title: string;
  url?: string;
  city?: string;
  query?: string;
}): string | undefined {
  // An explicit URL from the user always wins.
  if (args.url && args.url.trim()) return args.url.trim();

  const q = encodeURIComponent((args.query ?? args.title).trim());
  switch (args.kind) {
    case "movie_ticket":
      // BookMyShow search — resolves to the movie page for the user's city.
      return `https://in.bookmyshow.com/explore/home/search?q=${q}`;
    case "event":
      return `https://in.bookmyshow.com/explore/home/search?q=${q}`;
    case "product":
      return `https://www.amazon.in/s?k=${q}`;
    default:
      return undefined;
  }
}
