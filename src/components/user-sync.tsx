"use client";

import * as React from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

/**
 * Lazily syncs the signed-in Clerk user into Convex's `users` table on first load,
 * so the app works even before the Clerk webhook is configured. Idempotent.
 */
export function UserSync() {
  const { isAuthenticated } = useConvexAuth();
  const sync = useMutation(api.users.syncCurrentUser);
  const done = React.useRef(false);

  React.useEffect(() => {
    if (isAuthenticated && !done.current) {
      done.current = true;
      sync().catch(() => {
        done.current = false;
      });
    }
  }, [isAuthenticated, sync]);

  return null;
}
