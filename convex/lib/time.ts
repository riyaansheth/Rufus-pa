/**
 * Timezone helpers shared by the assistant (parsing user-local datetimes) and the
 * daily-briefing cron (finding each user's local hour). All DST-correct via Intl.
 */

/**
 * Minutes east of UTC for `tz` at a given instant (handles DST correctly by
 * asking Intl what the wall-clock reads there).
 */
export function tzOffsetMinutes(tz: string, atUtcMs: number): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const p = dtf.formatToParts(new Date(atUtcMs)).reduce<Record<string, string>>(
      (acc, part) => {
        acc[part.type] = part.value;
        return acc;
      },
      {},
    );
    const asUTC = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
    return Math.round((asUTC - atUtcMs) / 60000);
  } catch {
    return 0;
  }
}

/** Start/end epoch (ms) of "today" as seen in the user's timezone `tz`. */
export function todayWindowInTz(tz: string): {
  dayStartMs: number;
  dayEndMs: number;
} {
  const nowMs = Date.now();
  let y: number, m: number, d: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(nowMs))
      .reduce<Record<string, string>>((acc, p) => {
        acc[p.type] = p.value;
        return acc;
      }, {});
    y = +parts.year;
    m = +parts.month;
    d = +parts.day;
  } catch {
    const now = new Date(nowMs);
    y = now.getUTCFullYear();
    m = now.getUTCMonth() + 1;
    d = now.getUTCDate();
  }
  const startUtcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetMin = tzOffsetMinutes(tz, startUtcGuess);
  const dayStartMs = startUtcGuess - offsetMin * 60000;
  return { dayStartMs, dayEndMs: dayStartMs + 24 * 60 * 60 * 1000 - 1 };
}

/** Current hour-of-day (0-23) in `tz`. Used by the daily-briefing cron. */
export function currentHourInTz(tz: string): number {
  try {
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      hour: "2-digit",
    }).format(new Date());
    const h = parseInt(s, 10);
    return Number.isNaN(h) ? new Date().getUTCHours() : h;
  } catch {
    return new Date().getUTCHours();
  }
}

/**
 * Parse a datetime the assistant produced into an epoch (ms).
 *
 * If the string already carries a timezone offset (or "Z"), it is unambiguous and
 * parsed directly. If it is a *naive* wall-clock string (no offset), we interpret it
 * in the user's timezone `tz` — NOT the server's UTC. Without this, "4 PM" from an
 * IST user would land at 4 PM UTC.
 */
export function toMs(
  value?: string | number | null,
  tz?: string,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return value;

  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
  if (hasOffset || !tz) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  // Naive wall-clock in `tz`: treat as UTC, then subtract the zone offset.
  const asUtc = Date.parse(value.endsWith("Z") ? value : value + "Z");
  if (Number.isNaN(asUtc)) {
    const fallback = Date.parse(value);
    return Number.isNaN(fallback) ? undefined : fallback;
  }
  const offsetMin = tzOffsetMinutes(tz, asUtc);
  return asUtc - offsetMin * 60000;
}
