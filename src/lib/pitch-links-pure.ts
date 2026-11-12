import { createHmac, timingSafeEqual } from "node:crypto";

// Tracked pitch links (BUSINESS): a proposal or contract shared as /p/<token> instead of an attachment, with a view log.
// Pure rules: tokens, expiry/revoke, beacon math, rate limit, what a view may store. IO side: pitch-links.ts. Tests: tests/pitch-links.test.ts.
// Creating a link sends nothing: the owner copies it and sends it himself.

export const MAX_DAYS = 90, DEFAULT_DAYS = 14, MAX_VIEWS = 500, MAX_LINKS = 200;
export const MAX_SECS = 4 * 3600; // one open counts at most 4 h on the page
export const BEACON_LIMIT = 20, OPEN_LIMIT = 30, BEACON_WINDOW_MS = 60_000; // per verified link per minute (the page beats every 15 s)

export type View = { id: string; at: string; secs: number; ua: string; ip: string };
export type PitchLink = { id: string; contractId: string; n: number; title: string; nonce: string; at: string; exp: number; notify: boolean; revoked?: string; views: View[] };

// Same scheme as the /w preview links (workspace-pure.ts), on a key derived from that one (domain-separated: a /w sig is never a /p sig).
export const pitchKey = (previewKey: Buffer) => createHmac("sha256", previewKey).update("pitch-v1").digest();
const sign = (key: Buffer, id: string, exp: number, nonce: string) => createHmac("sha256", key).update(`pitch/${id}/${exp}/${nonce}`).digest("base64url").slice(0, 22);
export const linkToken = (key: Buffer, l: Pick<PitchLink, "id" | "exp" | "nonce">) => `${l.id}.${l.exp}.${sign(key, l.id, l.exp, l.nonce)}`;

export function parseToken(t: unknown): { id: string; exp: number; sig: string } | null {
  if (typeof t !== "string" || t.length > 80) return null;
  const [id, exp, sig, extra] = t.split(".");
  return extra === undefined && /^[A-Za-z0-9_-]{12}$/.test(id ?? "") && /^\d{1,12}$/.test(exp ?? "") && /^[A-Za-z0-9_-]{22}$/.test(sig ?? "") ? { id, exp: Number(exp), sig } : null;
}

/** ok only for a well-formed token whose sig matches the stored link (and its expiry), not revoked and not expired. */
export function tokenState(key: Buffer, t: unknown, l: PitchLink | undefined, nowS: number): "ok" | "bad" | "expired" | "revoked" {
  const p = parseToken(t);
  if (!p || !l || l.id !== p.id || l.exp !== p.exp) return "bad";
  const want = Buffer.from(sign(key, l.id, l.exp, l.nonce)), got = Buffer.from(p.sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return "bad";
  if (l.revoked) return "revoked";
  return nowS >= l.exp ? "expired" : "ok";
}

export const expiryFor = (days: unknown, nowS: number) => Math.floor(nowS) + Math.round(Math.min(MAX_DAYS, Math.max(1, typeof days === "number" && Number.isFinite(days) ? days : DEFAULT_DAYS))) * 86400;

/** New seconds-on-page for a view: never goes down, never past the wall clock since it opened (+5 s slack) or MAX_SECS. */
export function beaconSecs(prev: number, reported: unknown, openedAtMs: number, nowMs: number): number {
  const r = typeof reported === "number" && Number.isFinite(reported) ? reported : 0;
  const wall = Math.max(0, (nowMs - openedAtMs) / 1000 + 5);
  return Math.max(prev, Math.floor(Math.min(r, wall, MAX_SECS)));
}

/** Fixed window per key. Mutates the map (one per process); drops stale keys so it can't grow. */
export function rateOk(m: Map<string, { start: number; n: number }>, key: string, now: number, limit = BEACON_LIMIT, windowMs = BEACON_WINDOW_MS): boolean {
  if (m.size > 5000) for (const [k, v] of m) if (now - v.start >= windowMs) m.delete(k);
  const s = m.get(key);
  if (!s || now - s.start >= windowMs) { m.set(key, { start: now, n: 1 }); return true; }
  return ++s.n <= limit;
}

/** At most the first 3 octets of an IPv4 address (first 3 groups of IPv6); "" when unknown. Never the full address. */
export function ipPrefix(forwardedFor: string | null | undefined): string {
  const ip = (forwardedFor ?? "").split(",")[0].trim().replace(/^::ffff:/i, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}`;
  return /^[0-9a-f:]+$/i.test(ip) && ip.includes(":") ? ip.split(":").slice(0, 3).join(":").toLowerCase() : "";
}

/** Link unfurlers and mail scanners: they open links nobody read, so they are not views. */
export const isPreviewUa = (ua: string | null | undefined) =>
  /bot|crawl|spider|preview|slurp|facebookexternalhit|whatsapp|safelinks|microsoft office|ms-office|slack-imgproxy|embedly|headless/i.test(ua ?? "");

/** "Chrome on Android"-level only, never the raw string. */
export function coarseUa(ua: string | null | undefined): string {
  const s = ua ?? "";
  if (isPreviewUa(s)) return "Bot or link preview";
  const b = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Browser";
  const o = /Android/.test(s) ? "Android" : /iPhone|iPad/.test(s) ? "iOS" : /Windows/.test(s) ? "Windows" : /Mac OS X/.test(s) ? "macOS" : /Linux/.test(s) ? "Linux" : "";
  return o ? `${b} on ${o}` : b;
}

/** What BUSINESS shows per link. */
export const viewSummary = (l: PitchLink) => ({ views: l.views.length, secs: l.views.reduce((a, v) => a + v.secs, 0), last: l.views.at(-1)?.at ?? null });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** The read-only viewer page. The script only reports seconds visible to /p/<token>/beacon. */
export function viewerHtml(title: string, text: string, token: string, viewId: string, nonce: string): string {
  const beat = !viewId ? "" : `(()=>{let s=0,t=Date.now();const u=${JSON.stringify(`/p/${token}/beacon`)},v=${JSON.stringify(viewId)};
const add=()=>{if(document.visibilityState==="visible")s+=(Date.now()-t)/1000;t=Date.now();};
const send=()=>{add();navigator.sendBeacon(u,JSON.stringify({v,s:Math.floor(s)}));};
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")send();else t=Date.now();});
setInterval(()=>{if(document.visibilityState==="visible")send();},15000);})();`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>body{margin:0;background:#f7f7f5;color:#1a1a1a;font:16px/1.55 Georgia,serif}main{max-width:760px;margin:0 auto;padding:32px 16px}
h1{font-size:1.5rem;margin:0 0 1rem}pre{white-space:pre-wrap;word-wrap:break-word;font:inherit;margin:0}
@media (prefers-color-scheme:dark){body{background:#141414;color:#e8e8e6}}</style></head>
<body><main><h1>${esc(title)}</h1><pre>${esc(text)}</pre><p style="opacity:.6;font-size:.8rem;margin-top:2rem">Opens of this link are logged.</p></main><script nonce="${nonce}">${beat}</script></body></html>`;
}
export const viewerCsp = (nonce: string) => `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
