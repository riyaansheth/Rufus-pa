import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Rufuspa brand mark — a rounded-square "R" monogram with the brand gradient.
 * Matches the favicon (src/app/icon.svg). Use `size` to scale.
 */
export function Logo({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="rufuspa-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#rufuspa-logo-g)" />
      <path
        d="M11 24V8h6.4c3.2 0 5.3 1.9 5.3 4.9 0 2.1-1.1 3.7-3 4.4L23 24h-3.5l-2.8-6H14v6h-3zm3-8.6h3.1c1.5 0 2.4-.8 2.4-2.2s-.9-2.2-2.4-2.2H14v4.4z"
        fill="#fff"
      />
    </svg>
  );
}
