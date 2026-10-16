// The address the browser actually used. Behind Tailscale Serve (docs/PHONE.md) the proxy may send Host: localhost:3000 and the
// real name in X-Forwarded-Host, so redirects and the CSRF check must use the forwarded one. Pure, tested in tests/origin.test.ts.
const HOST = /^[a-z0-9.-]+(?::\d+)?$/i;

export function publicHost(h: { host?: string | null; forwardedHost?: string | null }): string | null {
  const f = h.forwardedHost?.split(",")[0].trim();
  if (f && HOST.test(f)) return f;
  const host = h.host?.trim();
  return host && HOST.test(host) ? host : null;
}

/** https for Tailscale names (Serve is HTTPS-only), else X-Forwarded-Proto, else the request's own protocol. */
export function publicOrigin(h: { host?: string | null; forwardedHost?: string | null; forwardedProto?: string | null }, fallback: string): string {
  const host = publicHost(h);
  if (!host) return new URL(fallback).origin;
  const fp = h.forwardedProto?.split(",")[0].trim().toLowerCase();
  const proto = /\.ts\.net(?::\d+)?$/i.test(host) ? "https" : fp === "https" || fp === "http" ? fp : new URL(fallback).protocol.replace(":", "");
  return `${proto}://${host}`;
}
