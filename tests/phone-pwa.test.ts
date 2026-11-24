import { test } from "node:test";
import assert from "node:assert/strict";
import { mSwRoute, needHref, offlineHtml, phoneManifest, PHONE_LINKS, PRECACHE, putAsk, takeAsk, topStories, ASK_KEY } from "../src/lib/phone-pwa-pure.ts";

test("manifest: installable standalone ORBIT app opening on /m with 192, 512 and maskable icons", () => {
  const m = phoneManifest();
  assert.equal(m.name, "ORBIT"); assert.equal(m.display, "standalone"); assert.equal(m.start_url, "/m");
  assert.ok(m.icons.some((i) => i.sizes === "192x192")); assert.ok(m.icons.some((i) => i.sizes === "512x512" && i.purpose === "any"));
  assert.ok(m.icons.some((i) => i.purpose === "maskable"));
});

test("service worker: shell and build files only; every /api call stays live, data pages are never touched", () => {
  assert.equal(mSwRoute("GET", "/m"), "shell");
  assert.equal(mSwRoute("GET", "/_next/static/chunks/a.js"), "static");
  assert.equal(mSwRoute("GET", "/icon-192.png"), "static");
  for (const p of ["/api/needs-you", "/api/life/journal", "/api/tasks", "/api/briefings"]) { assert.equal(mSwRoute("GET", p), "api"); assert.equal(mSwRoute("POST", p), "api"); }
  for (const p of ["/", "/chat", "/remote", "/login", "/m/other", "/_next/image", "/api"]) assert.equal(mSwRoute("GET", p), null, p);
  assert.equal(mSwRoute("POST", "/m"), null);
  assert.ok(PRECACHE.every((u) => !u.startsWith("/api")));
});

test("offline screen: says the laptop may be asleep, has a Try again button, EN and ET", () => {
  assert.match(offlineHtml("en"), /ORBIT is offline/); assert.match(offlineHtml("en"), /laptop may be asleep/);
  assert.match(offlineHtml("et"), /ORBIT ei vasta/); assert.match(offlineHtml("en"), /safe-area-inset-top/);
  assert.match(offlineHtml("en"), /min-height:44px/);
});

test("needHref: phone approvals open /remote; others open full ORBIT at the right place; never an unsafe scheme", () => {
  assert.equal(needHref({ task: "t1" }, "r1"), "/remote");
  assert.equal(needHref({ task: "t1" }), "/#o=operations&k=task&id=t1");
  assert.equal(needHref({ goal: "g1" }), "/#o=agents&k=goal&id=g1");
  assert.equal(needHref({ link: "#o=business&v=client" }), "/#o=business&v=client");
  assert.equal(needHref({ panel: "studio", view: "review" }), "/#o=studio&v=review");
  assert.equal(needHref({ href: "javascript:alert(1)" }), "/");
  assert.equal(needHref({ doctor: true }), "/");
});

test("ask hand-over: via sessionStorage once, not the URL; empty or overlong is refused", () => {
  const m = new Map<string, string>();
  const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  assert.equal(putAsk(s, "  "), null); assert.equal(putAsk(s, "x".repeat(2001)), null);
  assert.equal(putAsk(s, " plan my day "), "/chat"); assert.equal(m.get(ASK_KEY), "plan my day");
  assert.equal(takeAsk(s), "plan my day"); assert.equal(takeAsk(s), null);
});

test("topStories: titled stories with the first web citation for the picture", () => {
  const out = topStories([{ title: null, cites: [] }, { title: "A", cites: ["x", "y"] }, { title: "B", cites: [] }],
    [{ id: "x", url: "file:///etc", source: "Bad" }, { id: "y", url: "https://e.com/a", source: "E" }]);
  assert.deepEqual(out, [{ title: "A", url: "https://e.com/a", source: "E" }, { title: "B", url: null, source: null }]);
});

test("quick links stay inside ORBIT", () => { assert.ok(PHONE_LINKS.every((l) => l.href.startsWith("/") && !l.href.startsWith("//"))); });
