// Remote's offline cache policy (roadmap 8, 5.3). These functions are pasted into the service worker as source text
// (sw.js/route.ts uses fn.toString()), so each must be self-contained: no imports, no outside constants.

export type OfflineRoute = "shell" | "static" | "api" | "pass";

/** What the service worker does with a request. Only the Remote page, its static assets and the one Remote command
 *  endpoint are touched; every other /api request (and anything cross-origin) passes straight through, never cached. */
export function offlineRoute(method: string, path: string): OfflineRoute {
  const p = path.split("#")[0];
  if (method === "GET" && (p === "/remote" || p.startsWith("/remote?"))) return "shell";
  if (method === "GET" && (p.startsWith("/_next/static/") || /^\/(icon-(192|512)\.png|icons\/icon-maskable-512\.png|remote\/manifest\.webmanifest)$/.test(p))) return "static";
  if (method === "POST" && p === "/api/remote") return "api"; // ?stream=1 (core.ask) is not matched: passes through
  return "pass";
}

/** Commands whose last answer may be shown offline: reads only. approve/reject/stopAll/habit.done/core.ask are never
 *  cached or queued: they always go to the PC live (and the page disables them while offline). */
export function cachedRead(type: unknown): boolean {
  return type === "status" || type === "approval.list" || type === "night" || type === "brief";
}

/** After a read command's network attempt (status null = the fetch itself failed). */
export function onReadResponse(status: number | null): "store" | "purge" | "fallback" | "pass" {
  if (status === null || status === 502 || status === 504) return "fallback"; // PC/Tailscale unreachable (serve answers 502 when ORBIT is down)
  if (status === 401 || status === 403) return "purge"; // unpaired or revoked: forget the cached copy on this phone
  return status >= 200 && status < 300 ? "store" : "pass";
}

/** The /_next/static files the Remote shell HTML references, so a first install can precache them. */
export function shellAssets(html: string): string[] {
  return [...new Set(html.match(/\/_next\/static\/[^"'\s)<>\\]+/g) ?? [])];
}

/** "HH:MM" of a sync time in the phone's own clock, "" when missing or bad. */
export function syncedAt(iso: string | null | undefined): string {
  const d = new Date(iso ?? "");
  if (!iso || isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
