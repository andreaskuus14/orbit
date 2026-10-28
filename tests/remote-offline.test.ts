import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedRead, offlineRoute, onReadResponse, shellAssets, syncedAt } from "../src/lib/remote-offline-pure.ts";

test("offlineRoute: only the Remote shell, its static files and the Remote command endpoint", () => {
  assert.equal(offlineRoute("GET", "/remote"), "shell");
  assert.equal(offlineRoute("GET", "/remote?habit=x"), "shell");
  assert.equal(offlineRoute("GET", "/remote/sw.js"), "pass");
  assert.equal(offlineRoute("GET", "/remotex"), "pass");
  assert.equal(offlineRoute("GET", "/_next/static/chunks/a.js"), "static");
  assert.equal(offlineRoute("GET", "/icon-192.png"), "static");
  assert.equal(offlineRoute("GET", "/remote/manifest.webmanifest"), "static");
  assert.equal(offlineRoute("POST", "/api/remote"), "api");
  assert.equal(offlineRoute("POST", "/api/remote?stream=1"), "pass"); // core.ask stream
  for (const p of ["/api/remote/thumb?id=1", "/api/remote/push", "/api/remote/talk", "/api/brief", "/api/remote/pair"]) {
    assert.equal(offlineRoute("GET", p), "pass", p);
    assert.equal(offlineRoute("POST", p), "pass", p);
  }
  assert.equal(offlineRoute("GET", "/api/remote"), "pass");
  assert.equal(offlineRoute("GET", "/"), "pass");
});

test("cachedRead: reads only, never actions", () => {
  for (const t of ["status", "approval.list", "night", "brief"]) assert.equal(cachedRead(t), true, t);
  for (const t of ["approve", "reject", "stopAll", "habit.done", "core.ask", "navigate", null, undefined, 1]) assert.equal(cachedRead(t), false, String(t));
});

test("onReadResponse: store ok, fall back when unreachable, purge when unpaired", () => {
  assert.equal(onReadResponse(200), "store");
  assert.equal(onReadResponse(null), "fallback");
  assert.equal(onReadResponse(502), "fallback");
  assert.equal(onReadResponse(504), "fallback");
  assert.equal(onReadResponse(401), "purge");
  assert.equal(onReadResponse(403), "purge");
  assert.equal(onReadResponse(429), "pass");
  assert.equal(onReadResponse(503), "pass"); // remote switched off on the PC: show that, not stale data
  assert.equal(onReadResponse(500), "pass");
});

test("shellAssets: unique /_next/static urls from the html", () => {
  const html = `<link href="/_next/static/css/a.css" rel="stylesheet"/><script src="/_next/static/chunks/b.js" async></script><script src="/_next/static/chunks/b.js"></script>"\\/_next/static/chunks/c.js\\"`;
  assert.deepEqual(shellAssets(html), ["/_next/static/css/a.css", "/_next/static/chunks/b.js", "/_next/static/chunks/c.js"]);
  assert.deepEqual(shellAssets("<p>none</p>"), []);
});

test("syncedAt: HH:MM local, empty for bad input", () => {
  const d = new Date(2026, 9, 28, 7, 5);
  assert.equal(syncedAt(d.toISOString()), "07:05");
  assert.equal(syncedAt(""), "");
  assert.equal(syncedAt(null), "");
  assert.equal(syncedAt("nope"), "");
});

test("policy functions are self-contained (the service worker pastes their source)", () => {
  for (const f of [offlineRoute, cachedRead, onReadResponse, shellAssets]) {
    const copy = new Function(`return (${f})`)();
    assert.equal(typeof copy, "function");
  }
  assert.equal(new Function(`return (${offlineRoute})`)()("POST", "/api/remote"), "api");
  assert.deepEqual(new Function(`return (${shellAssets})`)()('"/_next/static/x.js"'), ["/_next/static/x.js"]);
});
