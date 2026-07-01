"use client";

import { ReactNode, useMemo } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ToastProvider } from "@/components/ui/toast";

/**
 * App-wide client providers: Clerk (auth) wrapping Convex (data/realtime), so every
 * Convex call is made with the signed-in user's identity token.
 */
export function Providers({ children }: { children: ReactNode }) {
  const convex = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    // A missing URL is a misconfiguration; surface it clearly rather than crash cryptically.
    if (!url) {
      throw new Error(
        "NEXT_PUBLIC_CONVEX_URL is not set. Run `npx convex dev` and copy it into .env.local.",
      );
    }
    return new ConvexReactClient(url);
  }, []);

  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <ToastProvider>{children}</ToastProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
