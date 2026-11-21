// The phone chat's service worker: makes /chat installable and opens it fast. It caches only the app itself (the /chat page and
// Next's hashed static files); chats, answers, files and every /api call always go to the PC live and are never stored on the phone.
// Rules in core-chat-pure.ts (chatSwRoute), tested in tests/core-chat.test.ts.
import { chatSwRoute } from "@/lib/core-chat-pure";

export const dynamic = "force-static";

const SW = `
const route = (${chatSwRoute});
const STATIC = "orbit-chat-static", SHELL = "/chat";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(fetch(SHELL, { credentials: "same-origin" }).then((r) => r.ok && !r.redirected ? caches.open(STATIC).then((c) => c.put(SHELL, r)) : null).catch(() => {})); });
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
// shortcut: old builds' chunks pile up; the cache is cleared once it passes 300 files.
const putStatic = async (req, r) => { const c = await caches.open(STATIC); if ((await c.keys()).length > 300) { await caches.delete(STATIC); return putStatic(req, r); } await c.put(req, r); };
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  const r = route(e.request.method, u.pathname);
  if (r === "static") return e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { if (res.ok) e.waitUntil(putStatic(e.request, res.clone())); return res; })));
  if (r === "shell") return e.respondWith(fetch(e.request).then((res) => { if (res.ok && !res.redirected) { const copy = res.clone(); e.waitUntil(caches.open(STATIC).then((c) => c.put(SHELL, copy))); } return res; },
    () => caches.match(SHELL).then((hit) => hit || Response.error())));
});
`;

export function GET() {
  return new Response(SW, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/chat" } });
}
