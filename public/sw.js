/*
 * Minimal service worker — its presence (with a fetch handler) makes Rufuspa
 * installable as a PWA. It deliberately does NOT cache app data or API/auth
 * responses (this is a live, auth-gated app); it only lets the browser offer
 * "install to home screen" and serves the shell fast. Network passthrough.
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass through to the network. No caching of authed/API responses on purpose.
  // (Not calling respondWith lets the browser handle the request normally.)
  void event;
});
