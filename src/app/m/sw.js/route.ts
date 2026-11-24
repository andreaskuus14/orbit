// The phone app's service worker (scope /m). It stores only the app shell: the /m page, Next's hashed build files and the icons.
// Every /api call goes to the PC live and is never stored (no answers, Needs-you items, journal or LIFE data on the phone);
// when the PC can't be reached /api answers 503 {offline:true} and a page load shows the offline screen.
// Rules in phone-pwa-pure.ts (mSwRoute, offlineHtml), tested in tests/phone-pwa.test.ts.
import { mSwRoute, offlineHtml, PRECACHE } from "@/lib/phone-pwa-pure";

export const dynamic = "force-static";

const SW = `
const route = (${mSwRoute});
const STATIC = "orbit-m-static", SHELL = "/m", PRECACHE = ${JSON.stringify(PRECACHE)};
const OFFLINE = { en: ${JSON.stringify(offlineHtml("en"))}, et: ${JSON.stringify(offlineHtml("et"))} };
const offline = () => new Response(OFFLINE[(self.navigator.language || "").toLowerCase().startsWith("et") ? "et" : "en"], { headers: { "content-type": "text/html; charset=utf-8" } });
// A redirect (to /login) or an error page is never stored as the shell.
const keep = (r) => r && r.ok && !r.redirected && r.type === "basic";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(STATIC).then((c) => Promise.all(PRECACHE.map((u) => fetch(u, { credentials: "same-origin" }).then((r) => keep(r) ? c.put(u, r) : null).catch(() => {}))))); });
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
// shortcut: old builds' chunks pile up; the cache is cleared once it passes 300 files.
const putStatic = async (req, r) => { const c = await caches.open(STATIC); if ((await c.keys()).length > 300) { await caches.delete(STATIC); return putStatic(req, r); } await c.put(req, r); };
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  const r = route(e.request.method, u.pathname);
  if (r === "api") return e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({ offline: true }), { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } })));
  if (r === "static") return e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { if (keep(res)) e.waitUntil(putStatic(e.request, res.clone())); return res; })));
  if (r === "shell") return e.respondWith(fetch(e.request).then((res) => { if (keep(res)) { const copy = res.clone(); e.waitUntil(caches.open(STATIC).then((c) => c.put(SHELL, copy))); } return res; },
    () => caches.match(SHELL).then((hit) => hit || offline())));
});
`;

export function GET() {
  return new Response(SW, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/m" } });
}
