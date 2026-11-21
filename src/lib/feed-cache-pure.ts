// Conditional feed downloads (efficiency pass 2): remember each feed's ETag / Last-Modified and send If-None-Match /
// If-Modified-Since next time. A 304 means the feed is byte-for-byte what was already ingested, so the run does exactly what it
// would have done with the same XML again (every item already stored, 0 added) without the download or the parse.
// Pure; IO in pulse.ts. ORBIT_FEED_CONDITIONAL=0 = plain GETs, as before.

export type Validators = { etag?: string; lastModified?: string; items: number; title: string | null };

/** The validators a response offers, or null when it has none (then nothing is remembered). Weak ETags are fine for If-None-Match. */
export function validatorsFrom(h: { get(name: string): string | null }, items: number, title: string | null): Validators | null {
  const clean = (v: string | null | undefined, max: number) => { const t = v?.trim(); return t && t.length <= max && !/[\r\n]/.test(t) ? t : undefined; };
  const etag = clean(h.get("etag"), 300), lm = clean(h.get("last-modified"), 100);
  const lastModified = lm && !Number.isNaN(Date.parse(lm)) ? lm : undefined;
  if (!etag && !lastModified) return null;
  return { ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}), items, title };
}

/** Request headers for a feed with remembered validators ({} without). */
export function conditionalHeaders(v: Validators | undefined): Record<string, string> {
  if (!v) return {};
  return { ...(v.etag ? { "If-None-Match": v.etag } : {}), ...(v.lastModified ? { "If-Modified-Since": v.lastModified } : {}) };
}
