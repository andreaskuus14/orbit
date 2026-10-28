// Remote's service worker. Push (roadmap 6.3): shows Web Push notifications and opens their /remote deep link; payloads are fixed
// labels from remote-push-pure.ts (pushLabel), a habit nudge adds its id for the Done action. Offline (8 / 5.3): caches the
// /remote shell and the last answer of the read commands only (policy in remote-offline-pure.ts); actions always go live.
import { cachedRead, offlineRoute, onReadResponse, shellAssets } from "@/lib/remote-offline-pure";

export const dynamic = "force-static";

const SW = `
const offlineRoute = (${offlineRoute}), cachedRead = (${cachedRead}), onReadResponse = (${onReadResponse}), shellAssets = (${shellAssets});
const STATIC = "orbit-remote-static", DATA = "orbit-remote-data", SHELL = "/remote", DATA_KEY = (t) => "/remote/__offline/" + t;
// Shell first, so the app opens offline after one visit; a failed precache never blocks install (push must keep working).
const precache = () => fetch(SHELL, { credentials: "same-origin" }).then(async (r) => {
  if (!r.ok || r.redirected) return;
  const html = await r.clone().text();
  const c = await caches.open(STATIC);
  await c.put(SHELL, r);
  await Promise.all(shellAssets(html).map((u) => c.add(u).catch(() => {})));
}).catch(() => {});
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(precache()); });
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
// shortcut: the static cache keeps old builds' chunks; it is cleared once it passes 300 files, upgrade to per-build pruning if that bites.
const putStatic = async (req, r) => { const c = await caches.open(STATIC); if ((await c.keys()).length > 300) { await caches.delete(STATIC); return putStatic(req, r); } await c.put(req, r); };
async function read(e) {
  const req = e.request;
  let type = null;
  try { type = JSON.parse((await req.clone().json()).cmd).type; } catch (_) {}
  if (!cachedRead(type)) return fetch(req); // approve, reject, stopAll, habit.done: live only, never cached or queued
  const r = await fetch(req).catch(() => null);
  const what = onReadResponse(r ? r.status : null);
  if (what === "store") { const body = await r.clone().text(); e.waitUntil(caches.open(DATA).then((c) => c.put(DATA_KEY(type), new Response(body, { headers: { "content-type": "application/json", "x-orbit-synced": new Date().toISOString() } })))); }
  if (what === "purge") e.waitUntil(caches.delete(DATA));
  if (what !== "fallback") return r;
  const hit = await caches.open(DATA).then((c) => c.match(DATA_KEY(type)));
  if (!hit) return r || Response.error();
  return new Response(hit.body, { headers: { "content-type": "application/json", "x-orbit-offline": hit.headers.get("x-orbit-synced") || "" } });
}
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  const route = offlineRoute(e.request.method, u.pathname + u.search);
  if (route === "api") return e.respondWith(read(e));
  if (route === "static") return e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) e.waitUntil(putStatic(e.request, r.clone())); return r; })));
  if (route === "shell") return e.respondWith(fetch(e.request).then((r) => { if (r.ok && !r.redirected) { const copy = r.clone(); e.waitUntil(caches.open(STATIC).then((c) => c.put(SHELL, copy))); } return r; },
    () => caches.match(SHELL).then((hit) => hit || Response.error())));
});
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  const url = typeof d.url === "string" && d.url.startsWith("/remote") ? d.url : "/remote";
  const habit = typeof d.habit === "string" && UUID.test(d.habit) ? d.habit : null; // habit nudge: one-tap Done (where the OS shows actions)
  e.waitUntil(self.registration.showNotification(String(d.title || "ORBIT"), { body: String(d.body || ""), tag: String(d.tag || "orbit"), icon: "/icon-192.png", data: { url, habit },
    ...(habit ? { actions: [{ action: "done", title: "Done" }] } : {}) }));
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The same /api/remote command the page sends; the device cookie rides along, so only the paired phone can mark it done.
const habitDone = (id) => fetch("/api/remote", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
  body: JSON.stringify({ cmd: JSON.stringify({ type: "habit.done", nonce: self.crypto.randomUUID(), id }) }) }).then((r) => r.ok, () => false);
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const url = new URL(data.url || "/remote", self.location.origin).href;
  if (e.action === "done" && data.habit) {
    e.waitUntil(habitDone(data.habit).then((ok) => ok ? self.registration.showNotification("Done", { body: "Marked done. Nice.", tag: "habit", icon: "/icon-192.png", data: { url: "/remote" } }) : self.clients.openWindow(url)));
    return;
  }
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((w) => w.url.startsWith(self.location.origin + "/remote"));
    return c ? c.focus().then((w) => (w || c).navigate(url)) : self.clients.openWindow(url);
  }));
});
`;

export function GET() {
  return new Response(SW, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/remote" } });
}
