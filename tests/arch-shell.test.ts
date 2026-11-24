import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMs, clock, money, needsLoop, shadowMap, shadowsOn, sunFact } from "../src/lib/arch-shell-pure.ts";

const idle = { building: false, holo: false, reduced: false, walk: false, spin: false, scan: false };

test("arch 3D draws on demand: idle model needs no loop", () => {
  assert.equal(needsLoop(idle), false);
  for (const k of ["building", "walk", "scan", "holo", "spin"] as const) assert.equal(needsLoop({ ...idle, [k]: true }), true, k);
  assert.equal(needsLoop({ ...idle, holo: true, reduced: true }), false, "reduced motion: the hologram stands still");
  assert.equal(needsLoop({ ...idle, spin: true, reduced: true }), false);
});

test("arch build animation window covers every part", () => {
  assert.equal(buildMs(0, 0.45), 1600);
  assert.equal(buildMs(10, 0.45), 6100);
  assert.equal(buildMs(-3, 0.45), 1600);
});

test("arch shadows only where they show", () => {
  assert.equal(shadowsOn({ real: true, sun: false, holo: false, scan: false }), true);
  assert.equal(shadowsOn({ real: false, sun: false, holo: false, scan: false }), false, "blueprint without sun");
  assert.equal(shadowsOn({ real: false, sun: true, holo: false, scan: false }), true);
  assert.equal(shadowsOn({ real: false, sun: true, holo: true, scan: false }), false);
  assert.equal(shadowsOn({ real: true, sun: true, holo: false, scan: true }), false);
  assert.deepEqual(shadowMap(0), [1024, 1024]);
  assert.deepEqual(shadowMap(1), [2048, 2048]);
});

test("arch one locale per language", () => {
  const d = new Date(2026, 5, 21, 4, 5);
  assert.equal(clock(d, "en"), "04:05");
  assert.equal(clock(d, "et"), "04:05");
  assert.equal(clock(null, "en"), "—");
  assert.match(money(48200, "en"), /€48,200/);
  assert.match(money(48200, "et").replace(/\s/g, " "), /48 200 €/);
});

test("arch sun line is one key with numbers", () => {
  assert.deepEqual(sunFact(-2, 10), { key: "arch.sunDown", vars: {} });
  assert.deepEqual(sunFact(41.6, 180.2), { key: "arch.sunUp", vars: { alt: 42, az: 180 } });
});

test("ArchWorld: no idle render loop, no spaced capitals, no forced locale, no sync stringify on edit", () => {
  const src = readFileSync(new URL("../src/components/ArchWorld.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /frameloop=\{paused \? "never" : "always"\}/);
  assert.match(src, /"demand"/);
  assert.doesNotMatch(src, /uppercase tracking-widest/);
  assert.doesNotMatch(src, /"et-EE"|toLocaleString\("en"\)/);
  assert.doesNotMatch(src, /"Sun below the horizon"|"Jun 21"|"Lat"/);
  assert.doesNotMatch(src, /[📚📐🚶👁☀🌤🏘⬇]/u, "no emoji as icons");
});
