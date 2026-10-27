import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPalace, importance, move, plinthRadius, walkable, type PalaceItem } from "../src/lib/memory-palace-pure.ts";

const KINDS = ["note", "idea", "decision", "project", "research", "journal", "goal", "link"];
function items(n: number, seed = 7): PalaceItem[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => ({ id: `m${i}`, kind: KINDS[Math.floor(rnd() ** 2 * KINDS.length)], source: rnd() < 0.3 ? "core-auto" : null, links: Math.floor(rnd() * 6) }));
}

test("importance grows with links and weighs decisions, stays in 0..1", () => {
  assert.ok(importance({ kind: "note", source: null, links: 3 }) > importance({ kind: "note", source: null, links: 0 }));
  assert.ok(importance({ kind: "decision", source: null, links: 0 }) > importance({ kind: "note", source: null, links: 0 }));
  assert.ok(importance({ kind: "goal", source: "core", links: 99 }) <= 1);
});

test("journal stays out unless the private toggle is on", () => {
  const it = items(80);
  assert.ok(it.some((m) => m.kind === "journal"));
  const shut = buildPalace(it), open = buildPalace(it, true);
  assert.ok(!shut.rooms.some((r) => r.kind === "journal"));
  assert.equal(shut.plinths.length, it.filter((m) => m.kind !== "journal").length);
  assert.ok(open.rooms.some((r) => r.kind === "journal"));
  assert.equal(open.plinths.length, it.length);
});

for (const n of [0, 1, 5, 60, 900]) test(`layout holds together with ${n} memories`, () => {
  const p = buildPalace(items(n), true);
  assert.deepEqual(buildPalace(items(n), true), p, "deterministic");
  assert.equal(p.plinths.length, n);
  for (let i = 0; i < p.rooms.length; i++) for (let j = i + 1; j < p.rooms.length; j++) {
    const a = p.rooms[i], b = p.rooms[j];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= a.r + b.r, `rooms ${a.kind}/${b.kind} overlap`);
  }
  for (const q of p.plinths) {
    const r = p.rooms[q.room];
    assert.ok(Math.hypot(q.x - r.x, q.z - r.z) + plinthRadius(q.size) < r.r, "plinth inside its room");
  }
  assert.ok(walkable(p, 0, 0), "spawn at the hub centre");
  // every room's centre is reachable in a straight walk from the hub along its corridor (the lane stays clear)
  for (const r of p.rooms) for (let t = 0; t <= 1; t += 0.01) assert.ok(walkable(p, r.x * t, r.z * t), `lane to ${r.kind} blocked at ${t}`);
});

test("walking never leaves the walls", () => {
  const p = buildPalace(items(200));
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let x = 0, z = 0;
  for (let k = 0; k < 20000; k++) {
    [x, z] = move(p, x, z, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6);
    assert.ok(walkable(p, x, z));
  }
  assert.ok(!walkable(p, 1e4, 0), "far outside is not walkable");
  assert.deepEqual(move(p, 0, 0, 0, 1e4), [0, 0], "a step through the wall is refused");
});
