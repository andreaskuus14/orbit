import { test } from "node:test";
import assert from "node:assert/strict";
import { isFresh, isPlanetWorld, journalStreak, placeAt, PLANET_WORLDS, worldScene } from "../src/lib/planet-worlds-pure.ts";

const NOW = new Date(2026, 10, 2, 15).getTime(); // 2 Nov 2026, 15:00 local
const H = 3_600_000, DAY = 24 * H;
const iso = (t: number) => new Date(t).toISOString();
const key = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

test("every world survives junk input with an empty scene", () => {
  for (const id of PLANET_WORLDS) for (const junk of [null, 3, "x", [], {}, { prospects: "no", files: [null, 1], items: {}, watchlist: [7], tasks: [{}], habits: null, journal: [{}] }]) {
    const s = worldScene(id, junk, NOW);
    assert.ok(Array.isArray(s.places) && Array.isArray(s.zones) && typeof s.summary === "string", id);
    for (const p of s.places) assert.ok(p.at.every(Number.isFinite) && Number.isFinite(p.size), `${id} finite`);
  }
  assert.ok(isPlanetWorld("vault") && !isPlanetWorld("memory") && !isPlanetWorld(null));
});

test("fresh = within the last 24 h, not far in the future", () => {
  assert.ok(isFresh(NOW - H, NOW));
  assert.ok(!isFresh(NOW - DAY - 1, NOW));
  assert.ok(!isFresh(NOW + DAY, NOW));
  assert.ok(!isFresh(0, NOW));
});

test("BUSINESS: one pier per stage, ships line up along it, new leads glow", () => {
  const s = worldScene("business", { prospects: [
    { id: "a", name: "Cafe", stage: "lead", fee: 0, created_at: iso(NOW - H), updated_at: iso(NOW - H) },
    { id: "b", name: "Gym", stage: "lead", fee: 300, created_at: iso(NOW - 9 * DAY), updated_at: iso(NOW - 9 * DAY) },
    { id: "c", name: "Shop", stage: "paying", fee: 500, created_at: iso(NOW - 9 * DAY), updated_at: iso(NOW - 9 * DAY) },
    { id: "d", name: "Odd", stage: "weird" },
  ] }, NOW);
  const [a, b, c, d] = s.places;
  assert.equal(a.at[0], b.at[0]);
  assert.notEqual(a.at[2], b.at[2]);
  assert.notEqual(a.at[0], c.at[0]);
  assert.equal(d.sub.startsWith("lead"), true); // unknown stage falls back to lead
  assert.deepEqual(s.places.map((p) => p.fresh), [true, false, false, false]);
  assert.ok(b.size > a.size); // bigger fee, bigger ship
  assert.equal(s.zones.length, 6);
});

test("VAULT: newest files first, a cluster per kind, bigger files taller", () => {
  const s = worldScene("vault", { files: [
    { name: "a/old.pdf", size: 10, mtime: NOW - 5 * DAY, type: "pdf" },
    { name: "new.png", size: 5_000_000, mtime: NOW - H, type: "image" },
  ] }, NOW);
  assert.deepEqual(s.places.map((p) => p.label), ["new.png", "old.pdf"]);
  assert.ok(s.places[0].fresh && !s.places[1].fresh);
  assert.ok(s.places[0].size > s.places[1].size);
  assert.deepEqual(s.zones.map((z) => z.label), ["image", "pdf"]);
});

test("ANALYTICS: a column per area and day, today highlighted, height by count", () => {
  const items = [{ at: iso(NOW - H), area: "core" }, { at: iso(NOW - 2 * H), area: "core" }, { at: iso(NOW - 3 * DAY), area: "agents" }, { at: iso(NOW - 60 * DAY), area: "core" }];
  const s = worldScene("analytics", { items }, NOW);
  assert.equal(s.places.length, 2); // 60 days ago is off the terrain
  const today = s.places.find((p) => p.fresh)!;
  assert.equal(today.label.startsWith("core"), true);
  assert.ok(today.size > s.places.find((p) => !p.fresh)!.size);
});

test("OPERATIONS: halls by state; only running machines spin", () => {
  const s = worldScene("operations", { tasks: [{ id: "1", title: "Scout", status: "running", created_at: iso(NOW - H) }, { id: "2", title: "Old", status: "cancelled" }, { id: "3", status: "needs_approval" }] }, NOW);
  assert.deepEqual(s.places.map((p) => [p.spin, p.sub.split(" · ")[1]]), [[true, "running"], [false, "cancelled"], [false, "needs_approval"]]);
  assert.equal(s.summary, "1 running, 3 recent");
});

test("LIFE: never reads journal text; streak counts back from today or yesterday", () => {
  const secret = "my private diary line";
  const journal = [0, 1, 2, 4].map((d) => ({ date: key(NOW - d * DAY), text: secret }));
  const s = worldScene("life", { habits: [{ id: "h", name: "Run", streak: 9, doneToday: true }], journal }, NOW);
  assert.ok(!JSON.stringify(s).includes(secret));
  assert.equal(s.places.filter((p) => p.shape === "bloom").length, 4);
  assert.equal(s.places.filter((p) => p.shape === "bloom" || p.shape === "seed").length, 28);
  assert.equal(journalStreak(journal.map((j) => j.date), NOW), 3);
  assert.equal(journalStreak([key(NOW - DAY), key(NOW - 2 * DAY)], NOW), 2); // today not written yet
  assert.equal(journalStreak([key(NOW - 3 * DAY)], NOW), 0);
});
