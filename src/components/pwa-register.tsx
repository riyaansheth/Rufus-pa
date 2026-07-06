"use client";

import { useEffect } from "react";

/** Registers the service worker so the app is installable to the home screen. */
export function PwaRegister() {
  useEffect(() => {
    if (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* SW is a progressive enhancement — ignore failures */
      });
    }
  }, []);
  return null;
}
