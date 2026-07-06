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
  if (args.url && args.url.trim()) return applyAffiliate(args.url.trim());

  // Prefer the clean search term (movie/product name) over the verbose monitor
  // title, which often carries dates/seats/venue text that breaks search.
  const term = (args.query ?? args.title).trim();
  switch (args.kind) {
    case "movie_ticket":
    case "event":
      // Synchronous fallback: land ON BookMyShow (never Google). The assistant
      // resolves the SPECIFIC movie page via web search at request time
      // (resolveBookingUrl in assistant.ts); this is used when that's skipped.
      return applyAffiliate(bookMyShowCityUrl(args.city));
    case "product":
      return applyAffiliate(`https://www.amazon.in/s?k=${encodeURIComponent(term)}`);
    default:
      return undefined;
  }
}

/**
 * Wrap a provider URL with an affiliate/partner redirect when configured. Set
 * AFFILIATE_LINK_TEMPLATE on the Convex deployment to something like
 * `https://linksredirect.com/?cid=XXXXX&source=linkkit&url={url}` (Cuelinks) or
 * your INRDeals/other network's deep-link format containing `{url}`. Idempotent
 * (won't double-wrap) and a no-op until the env var is set — so booking links
 * become monetized the moment you paste your template, with zero code changes.
 */
export function applyAffiliate(url?: string): string | undefined {
  if (!url) return url;
  const tmpl = process.env.AFFILIATE_LINK_TEMPLATE;
  if (!tmpl || !tmpl.includes("{url}")) return url;
  const prefix = tmpl.split("{url}")[0];
  if (prefix && url.startsWith(prefix)) return url; // already wrapped
  return tmpl.replace("{url}", encodeURIComponent(url));
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
  return (
    isBookMyShowUrl(url) &&
    (/bookmyshow\.com\/.*\b(movies|events|plays|sports)\//i.test(url) ||
      /\bET\d{8}\b/i.test(url))
  );
}

/** True for any BookMyShow URL. */
export function isBookMyShowUrl(url: string): boolean {
  return /(^|\/|\.)bookmyshow\.com/i.test(url);
}

/** Extract BookMyShow's event code (e.g. ET00312345) from a URL, if present. */
export function bmsEventCode(url: string): string | undefined {
  return /\b(ET\d{8})\b/i.exec(url)?.[1]?.toUpperCase();
}

/**
 * Deep-link straight to BookMyShow's SHOWTIME PICKER for a given date.
 * BMS movie pages (`…/movies/{city}/{slug}/ET00xxxxxx`) have a stable sibling
 * `…/movies/{city}/{slug}/buytickets/ET00xxxxxx/YYYYMMDD` that lists that day's
 * shows — the closest a link can legally get to seat selection. Falls back to
 * the movie page itself when the URL shape or date isn't available.
 */
export function bmsShowtimesUrl(movieUrl: string, yyyymmdd?: string): string {
  const code = bmsEventCode(movieUrl);
  if (!code || !yyyymmdd) return movieUrl;
  try {
    const u = new URL(movieUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const codeIdx = parts.findIndex((p) => /\bET\d{8}\b/i.test(p));
    if (codeIdx < 1) return movieUrl;
    const base = parts.slice(0, codeIdx).join("/");
    return `${u.origin}/${base}/buytickets/${code}/${yyyymmdd}`;
  } catch {
    return movieUrl;
  }
}
