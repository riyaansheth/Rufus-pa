import type { MetadataRoute } from "next";

/**
 * PWA manifest — makes Rufuspa installable to the phone/desktop home screen so it
 * opens standalone, like a native app. Served at /manifest.webmanifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rufuspa — AI Executive Assistant",
    short_name: "Rufuspa",
    description:
      "Your supervised AI executive assistant: calendar, reminders, tasks, monitors, and approvals — with human approval on anything sensitive.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0b0f",
    theme_color: "#6366f1",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
