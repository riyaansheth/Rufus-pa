/**
 * Open an external URL in a new tab WITHOUT leaking a referrer.
 *
 * Some sites (e.g. BookMyShow's Cloudflare) treat a cross-site `Referer` header
 * as a bot signal and block the request — even though typing the same URL works
 * (no referrer). This is normal link hygiene (`rel="noreferrer"`), not a security
 * bypass: we simply don't tell the destination which page the click came from.
 *
 * Pattern: pre-open a blank tab synchronously inside the click (so pop-up
 * blockers don't stop it), then navigate it from a document whose referrer policy
 * is `no-referrer`, so the destination request carries no Referer.
 */

/** Open a placeholder tab now (call inside the click gesture). May return null. */
export function preopenTab(): Window | null {
  const w = window.open("about:blank", "_blank");
  if (w) {
    try {
      w.document.open();
      w.document.write(
        `<!doctype html><html><head><meta name="referrer" content="no-referrer"><title>Opening…</title></head><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#666"><p>Opening booking page…</p></body></html>`,
      );
      w.document.close();
    } catch {
      /* non-fatal */
    }
  }
  return w;
}

/** Navigate a pre-opened tab (or a fresh one) to `url` with no referrer. */
export function navigateNoReferrer(pre: Window | null, url: string): void {
  if (pre && !pre.closed) {
    try {
      pre.document.open();
      pre.document.write(
        `<!doctype html><html><head><meta name="referrer" content="no-referrer"><title>Opening…</title></head><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#666"><p>Opening booking page…</p><script>location.replace(${JSON.stringify(
          url,
        )})</script></body></html>`,
      );
      pre.document.close();
      return;
    } catch {
      /* fall through to a plain open */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Close a pre-opened tab that ended up unused. */
export function closeTab(pre: Window | null): void {
  if (pre && !pre.closed) pre.close();
}
