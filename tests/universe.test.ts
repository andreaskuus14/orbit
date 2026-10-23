import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubAt, universeFrom } from "../src/lib/universe-pure.ts";
import { stateAt, validate, type LedgerEvent } from "../src/lib/ledger-pure.ts";

let n = 0;
const ev = (type: string, planet: string, at: string, data: object): LedgerEvent => {
  const r = validate({ id: `u${++n}`, at, type, planet, data });
  if ("error" in r) throw new Error(r.error);
  return r.ok;
};
const NOW = "2026-10-23T12:00:00Z", now = Date.parse(NOW);
const finite01 = (u: ReturnType<typeof universeFrom>) => {
  for (const v of [u.nebula, ...Object.values(u.vitality), ...Object.values(u.light).flatMap((l) => [l.glow, l.orbit, l.dim])]) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, String(v));
};

test("universe: zero data looks like today", () => {
  for (const s of [null, undefined, stateAt([], NOW)]) {
    const u = universeFrom(s, now);
    finite01(u);
    assert.equal(u.comets + u.moons + u.nebula, 0);
    assert.ok(Object.values(u.light).every((l) => l.glow === 0 && l.orbit === 0 && l.dim === 0));
  }
});

test("universe: stateAt counts the last 7 days per planet", () => {
  const s = stateAt([
    ev("focus.session", "life", "2026-10-22T10:00:00Z", { minutes: 5 }),
    ev("focus.session", "life", "2026-10-10T10:00:00Z", { minutes: 5 }), // too old
    ev("memory.saved", "memory", "2026-10-23T12:00:00Z", { memoryId: "m", kind: "note" }), // inclusive
  ], NOW);
  assert.equal(s.recent.life, 1);
  assert.equal(s.recent.memory, 1);
  assert.equal(s.recent.studio, 0);
});

test("universe: vitality, dimming, comets, moons, nebula", () => {
  const events: LedgerEvent[] = [];
  for (let i = 0; i < 30; i++) events.push(ev("memory.saved", "memory", "2026-10-22T10:00:00Z", { memoryId: `m${i}`, kind: "note" }));
  events.push(ev("focus.session", "life", "2026-10-22T10:00:00Z", { minutes: 5 }));
  for (const [i, views] of [100, 200, 900, 5000].entries()) events.push(ev("clip.outcome48h", "studio", `2026-10-2${i}T10:00:00Z`, { clipId: `c${i}`, views, likes: 1 }));
  events.push(ev("clip.outcome48h", "studio", "2026-09-01T10:00:00Z", { clipId: "old", views: 99999, likes: 1 }));
  for (const p of ["A", "B", "C"]) events.push(ev("business.stage", "business", "2026-10-01T10:00:00Z", { prospect: p, to: "paying" }));
  events.push(ev("business.stage", "business", "2026-10-02T10:00:00Z", { prospect: "C", to: "lost" }));
  const u = universeFrom(stateAt(events, NOW), now);
  finite01(u);
  assert.equal(u.vitality.memory, 1);
  assert.ok(u.vitality.life > 0 && u.vitality.life < u.vitality.studio);
  assert.equal(u.light.arch.dim, 0.15); // idle planets dim a little once there is data
  assert.equal(u.light.memory.dim, 0);
  assert.equal(u.comets, 2); // 900 and 5000 are above the median; the old outcome is outside the window
  assert.equal(u.moons, 2);
  assert.ok(u.nebula > 0.5 && u.nebula < 1);
});

test("universe: caps and junk stay in range", () => {
  const junk = { counts: { "memory.saved": 1e9 }, recent: { memory: NaN, life: -3, studio: Infinity }, businessStages: { paying: 50 }, lastClipOutcomes: [] } as never;
  const u = universeFrom(junk, now);
  finite01(u);
  assert.equal(u.moons, 8);
  assert.equal(u.nebula, 1);
});

test("scrubAt: clamps days and rounds to the hour; 0 is live", () => {
  assert.equal(scrubAt(0, now), null);
  assert.equal(scrubAt(0.4, now), null);
  assert.equal(scrubAt(NaN, now), null);
  assert.equal(scrubAt(1, now + 1234), "2026-10-22T12:00:00.000Z");
  assert.equal(scrubAt(999, now), "2026-04-26T12:00:00.000Z");
  assert.equal(scrubAt(-5, now), null);
});
