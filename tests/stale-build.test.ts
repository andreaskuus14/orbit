import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildChanged, isChunkError, MIN_CHECK_GAP_MS, mayReload, RELOAD_GUARD_MS, shouldCheck } from "../src/lib/stale-build-pure.ts";

test("isChunkError: webpack ChunkLoadError by name or message", () => {
  const e = new Error("Loading chunk 833 failed.\n(error: http://127.0.0.1:3000/_next/static/chunks/833.js)");
  assert.equal(isChunkError(e), true);
  const named = Object.assign(new Error("whatever"), { name: "ChunkLoadError" });
  assert.equal(isChunkError(named), true);
  assert.equal(isChunkError(new Error("Loading CSS chunk 12 failed")), true);
  assert.equal(isChunkError(new Error("Loading chunk app/page-abc failed.")), true);
});

test("isChunkError: native dynamic import failures (Chrome, Firefox, Safari)", () => {
  assert.equal(isChunkError(new TypeError("Failed to fetch dynamically imported module: http://x/_next/static/chunks/a.js")), true);
  assert.equal(isChunkError(new TypeError("error loading dynamically imported module")), true);
  assert.equal(isChunkError(new TypeError("Importing a module script failed.")), true);
  assert.equal(isChunkError("ChunkLoadError: Loading chunk 9 failed"), true);
});

test("isChunkError: unwraps ErrorEvent.error and PromiseRejectionEvent.reason", () => {
  assert.equal(isChunkError({ type: "error", message: "Uncaught", error: new Error("Loading chunk 5 failed") }), true);
  assert.equal(isChunkError({ type: "unhandledrejection", reason: Object.assign(new Error("x"), { name: "ChunkLoadError" }) }), true);
  const self: { reason?: unknown } = {}; self.reason = self; // no endless recursion
  assert.equal(isChunkError(self), false);
});

test("isChunkError: ordinary errors don't reload the page", () => {
  for (const e of [new Error("Cannot read properties of undefined"), new TypeError("Failed to fetch"), "network down", null, undefined, 42, {}])
    assert.equal(isChunkError(e), false, String(e));
});

test("mayReload: once per guard window, garbage = never reloaded", () => {
  const now = 1_000_000_000;
  assert.equal(mayReload(null, now), true);
  assert.equal(mayReload("nope", now), true);
  assert.equal(mayReload(String(now - 1000), now), false); // just reloaded: show the boundary instead of looping
  assert.equal(mayReload(String(now - RELOAD_GUARD_MS + 1), now), false);
  assert.equal(mayReload(String(now - RELOAD_GUARD_MS), now), true);
  assert.equal(mayReload(String(now + 60_000), now), true); // clock went back
});

test("buildChanged: only when both ids are known and differ", () => {
  assert.equal(buildChanged("a", "b"), true);
  assert.equal(buildChanged("a", "a"), false);
  assert.equal(buildChanged(null, "b"), false);
  assert.equal(buildChanged("a", null), false);
  assert.equal(buildChanged("", ""), false);
});

test("shouldCheck: visible only, throttled", () => {
  assert.equal(shouldCheck(0, MIN_CHECK_GAP_MS, true), true);
  assert.equal(shouldCheck(0, MIN_CHECK_GAP_MS - 1, true), false);
  assert.equal(shouldCheck(0, 10 * MIN_CHECK_GAP_MS, false), false);
});

test("wiring: boundary and watcher use the pure rules; launcher keeps the previous build's chunks", () => {
  const boundary = readFileSync(new URL("../src/components/PlanetBoundary.tsx", import.meta.url), "utf8");
  assert.match(boundary, /isChunkError\(error\)/);
  assert.match(boundary, /reloadOnce\(/);
  const watch = readFileSync(new URL("../src/components/StaleBuildWatch.tsx", import.meta.url), "utf8");
  for (const s of ['"unhandledrejection"', '"error"', '"visibilitychange"', '"focus"', "/api/health", "RELOAD_KEY"]) assert.ok(watch.includes(s), s);
  const orbit = readFileSync(new URL("../src/components/Orbit.tsx", import.meta.url), "utf8");
  assert.match(orbit, /<StaleBuildWatch open=\{panel\}/);
  const ps = readFileSync(new URL("../scripts/launch.ps1", import.meta.url), "utf8");
  assert.match(ps, /function Copy-PrevStatic/);
  assert.match(ps, /Switch-Release[\s\S]*Copy-PrevStatic/);
});

test("i18n: update toast in English and Estonian", () => {
  const src = ["en", "et"].map((l) => readFileSync(new URL(`../src/lib/i18n-${l}-pure.ts`, import.meta.url), "utf8")).join("\n");
  for (const k of ["update.ready", "update.reload"]) assert.equal(src.split(`"${k}":`).length - 1, 2, k);
});
