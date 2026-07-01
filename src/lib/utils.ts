import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner (shadcn convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a millisecond timestamp as a short human date+time. */
export function formatDateTime(ms?: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Format a millisecond timestamp as a date only. */
export function formatDate(ms?: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Relative "in 2 hours" / "3 days ago" style label. */
export function formatRelative(ms?: number | null, now = Date.now()): string {
  if (!ms) return "—";
  const diff = ms - now;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (abs >= size || unit === "second") {
      return rtf.format(Math.round(diff / size), unit);
    }
  }
  return "—";
}

/** Format a currency amount stored in minor-unit-agnostic number form. */
export function formatMoney(amount?: number | null, currency = "INR"): string {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}
