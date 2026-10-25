// Remote's service worker (roadmap 6.3): shows Web Push notifications and opens their /remote deep link. Push only: no fetch
// handler, nothing cached. Payloads are fixed labels from remote-push-pure.ts (pushLabel).
export const dynamic = "force-static";

const SW = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  const url = typeof d.url === "string" && d.url.startsWith("/remote") ? d.url : "/remote";
  e.waitUntil(self.registration.showNotification(String(d.title || "ORBIT"), { body: String(d.body || ""), tag: String(d.tag || "orbit"), icon: "/icon-192.png", data: { url } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/remote", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((w) => w.url.startsWith(self.location.origin + "/remote"));
    return c ? c.focus().then((w) => (w || c).navigate(url)) : self.clients.openWindow(url);
  }));
});
`;

export function GET() {
  return new Response(SW, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/remote" } });
}
