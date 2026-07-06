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

  // Prefer the clean search term (movie/product name) over the verbose monitor
  // title, which often carries dates/seats/venue text that breaks search.
  const term = (args.query ?? args.title).trim();
  switch (args.kind) {
    case "movie_ticket":
    case "event": {
      // BookMyShow has no public deep link to a specific movie's booking page
      // without its internal event id (which we won't scrape). A city-scoped
      // Google search reliably lands the top result on the exact BookMyShow
      // movie page — one tap to the right film, ToS-friendly.
      const parts = [term, args.city, "BookMyShow book tickets"].filter(Boolean);
      return `https://www.google.com/search?q=${encodeURIComponent(parts.join(" "))}`;
    }
    case "product":
      return `https://www.amazon.in/s?k=${encodeURIComponent(term)}`;
    default:
      return undefined;
  }
}
