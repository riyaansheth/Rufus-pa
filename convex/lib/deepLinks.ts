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
    case "event":
      // Synchronous fallback: land ON BookMyShow (never Google). The assistant
      // resolves the SPECIFIC movie page via web search at request time
      // (resolveBookingUrl in assistant.ts); this is used when that's skipped.
      return bookMyShowCityUrl(args.city);
    case "product":
      return `https://www.amazon.in/s?k=${encodeURIComponent(term)}`;
    default:
      return undefined;
  }
}

/** BookMyShow city movie listing (or homepage if no city). */
export function bookMyShowCityUrl(city?: string): string {
  const slug = city
    ? city
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : "";
  return slug
    ? `https://in.bookmyshow.com/explore/movies-${slug}`
    : "https://in.bookmyshow.com/";
}

/** True for a BookMyShow URL that points at a specific movie/event/play page. */
export function isBookMyShowEventUrl(url: string): boolean {
  return /bookmyshow\.com\/(movies|events|plays|sports)\//i.test(url);
}

/** True for any BookMyShow URL. */
export function isBookMyShowUrl(url: string): boolean {
  return /(^|\.)bookmyshow\.com/i.test(url);
}
