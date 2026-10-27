import { test } from "node:test";
import assert from "node:assert/strict";
import { admit, ANY_GAP_MS, CHIME_GAP_MS, COALESCE_START, cueFor, dawnDue, DEFAULT_VOLUME, HUM_STOPPED, mix, parseVolume, QUIET_SCALE, voiceFor, type MixInput } from "../src/lib/ambient-sound-pure.ts";

test("real events map to the right planet; everything else is silent", () => {
  assert.deepEqual(cueFor("clip.published"), { source: "studio", kind: "chime" });
  assert.deepEqual(cueFor("agent.completed", { status: "done" }), { source: "agents", kind: "chime" });
  assert.equal(cueFor("agent.completed", { status: "cancelled" }), null);
  assert.deepEqual(cueFor("deal.found"), { source: "markets", kind: "chime" });
  assert.deepEqual(cueFor("night.end"), { source: "core", kind: "dawn" });
  for (const t of ["agent.failed", "deal.hunt", "memory.saved", "core.turn", ""]) assert.equal(cueFor(t), null);
});

test("bursts coalesce per planet and across planets; dawn always plays", () => {
  const chime = (source: string) => ({ source, kind: "chime" as const });
  let s = COALESCE_START, r;
  r = admit(s, chime("studio"), 0); assert.equal(r.play, true); s = r.state;
  r = admit(s, chime("studio"), 2_000); assert.equal(r.play, false); assert.equal(r.state, s);
  r = admit(s, chime("agents"), ANY_GAP_MS - 1); assert.equal(r.play, false);
  r = admit(s, chime("agents"), ANY_GAP_MS); assert.equal(r.play, true); s = r.state;
  r = admit(s, chime("studio"), CHIME_GAP_MS); assert.equal(r.play, true); s = r.state;
  assert.equal(admit(s, { source: "core", kind: "dawn" }, CHIME_GAP_MS + 1).play, true);
});

test("mix: off and hidden are silent, quiet hours lower, Stop-all drops the hum", () => {
  const day: MixInput = { enabled: true, volume: 0.8, hidden: false, hour: 12, stopAll: false };
  assert.deepEqual(mix(day), { master: 0.8, hum: 1 });
  assert.equal(mix({ ...day, enabled: false }).master, 0);
  assert.equal(mix({ ...day, hidden: true }).master, 0);
  for (const hour of [23, 0, 7]) assert.equal(mix({ ...day, hour }).master, 0.8 * QUIET_SCALE);
  assert.equal(mix({ ...day, hour: 8 }).master, 0.8);
  assert.equal(mix({ ...day, hour: 22 }).master, 0.8);
  assert.equal(mix({ ...day, stopAll: true }).hum, HUM_STOPPED);
  assert.equal(mix({ ...day, volume: 3 }).master, 1);
  assert.equal(mix({ ...day, volume: NaN }).master, DEFAULT_VOLUME);
});

test("volume parsing falls back to the default", () => {
  assert.equal(parseVolume("0.3"), 0.3);
  assert.equal(parseVolume("0"), 0);
  for (const raw of [null, "", "x", "-1", "2"]) assert.equal(parseVolume(raw), DEFAULT_VOLUME);
});

test("dawn swell once per finished night shift", () => {
  const end = "2026-10-26T06:30:00.000Z";
  assert.equal(dawnDue(end, null), true);
  assert.equal(dawnDue(end, end), false);
  assert.equal(dawnDue(end, "2026-10-25T06:30:00.000Z"), true);
  assert.equal(dawnDue(undefined, null), false);
  assert.equal(dawnDue("nope", null), false);
  assert.equal(dawnDue(end, "garbage"), true);
});

test("planet drones: inner higher than outer, all audible and distinct LFOs", () => {
  const v = Array.from({ length: 13 }, (_, i) => voiceFor(i, 13));
  for (let i = 1; i < v.length; i++) { assert.ok(v[i].hz < v[i - 1].hz); assert.notEqual(v[i].lfoHz, v[i - 1].lfoHz); }
  assert.equal(v[12].hz, 110);
  for (const x of v) assert.ok(x.hz >= 110 && x.hz < 1000 && x.gain > 0 && x.lfoHz < 0.2);
});
