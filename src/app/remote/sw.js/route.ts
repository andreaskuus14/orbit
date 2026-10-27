// Remote's service worker (roadmap 6.3): shows Web Push notifications and opens their /remote deep link. Push only: no fetch
// handler, nothing cached. Payloads are fixed labels from remote-push-pure.ts (pushLabel); a habit nudge adds its id for the Done action.
export const dynamic = "force-static";

const SW = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
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
