import { test } from "node:test";
import assert from "node:assert/strict";
import { bizScene, gateOf, heightAt, lifeScene, opsScene, podAngle, timeScene, vaultScene } from "../src/lib/planet-scenes-pure.ts";

const NOW = Date.UTC(2026, 10, 25, 12), H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();

test("junk in, empty scenes out, never a throw", () => {
  for (const j of [null, 1, "x", [], {}, { tasks: "x", files: [null], prospects: [1], cost: { projects: {} }, habits: null }]) {
    assert.equal(opsScene(j, NOW).pods.length, 0);
    assert.equal(vaultScene(j, NOW).crystals.length, 0);
    assert.equal(bizScene(j, NOW).ships.length, 0);
    assert.equal(timeScene(j).peaks.length, 0);
    assert.equal(lifeScene(j).pods.length, 0);
  }
});

test("OPERATIONS: states map to gates, active work first, old finished jobs drop out, sub-tasks hidden", () => {
  assert.equal(gateOf("awaiting_approval"), "needs");
  assert.equal(gateOf("cancelled"), "failed");
  const s = opsScene({ tasks: [
    { id: "old", status: "done", created_at: iso(NOW - 50 * H), finished_at: iso(NOW - 49 * H) },
    { id: "d", status: "done", created_at: iso(NOW - 2 * H), finished_at: iso(NOW - H) },
    { id: "r", status: "running", created_at: iso(NOW - 3 * H) },
    { id: "a", status: "awaiting_approval", created_at: iso(NOW - H) },
    { id: "sub", parent_id: "r", status: "running", created_at: iso(NOW) },
  ] }, NOW);
  assert.deepEqual(s.pods.map((p) => p.id), ["r", "a", "d"]);
  assert.equal(s.gates.find((g) => g.gate === "done")!.count, 2);
  assert.ok(s.pods[0].moving && !s.pods[2].moving);
  assert.match(s.summary, /1 running, 1 need you, 1 done today/);
  for (const p of s.pods) assert.ok(Number.isFinite(podAngle(p, 1)));
});

test("VAULT: one shelf arc per kind (biggest first), crystal height grows with size, totals add up", () => {
  const s = vaultScene({ files: [
    { name: "a/x.png", type: "image", size: 10, mtime: NOW - H }, { name: "y.png", type: "image", size: 1e7, mtime: NOW - 5 * 86_400_000 }, { name: "z.pdf", type: "pdf", size: 2048, mtime: 0 },
  ] }, NOW);
  assert.deepEqual(s.kinds.map((k) => [k.kind, k.count]), [["image", 2], ["pdf", 1]]);
  assert.equal(s.total, 1e7 + 2058);
  const [small, big] = [s.crystals.find((c) => c.key === "a/x.png")!, s.crystals.find((c) => c.key === "y.png")!];
  assert.ok(big.h > small.h && small.fresh && !big.fresh);
  assert.equal(small.name, "x.png");
});

test("BUSINESS: tiers narrow and rise toward paying; lost deals are counted, not docked", () => {
  const s = bizScene({ prospects: [{ id: "1", name: "Cafe", stage: "lead", fee: 0 }, { id: "2", name: "Gym", stage: "paying", fee: 300 }, { id: "3", stage: "lost" }] }, NOW);
  assert.ok(s.tiers[0].r > s.tiers[4].r && s.tiers[4].y > s.tiers[0].y);
  assert.equal(s.lost, 1);
  assert.equal(s.ships.length, 2);
  assert.match(s.summary, /2 open deals, €300\/mo paying/);
});

test("ANALYTICS: one peak per project with real minutes, tallest for the most time", () => {
  const s = timeScene({ cost: { projects: [{ name: "Pet sim", minutes: 300 }, { name: null, minutes: 30 }, { name: "Zero", minutes: 0 }] }, daily: [{ done: 2, failed: 1 }] });
  assert.deepEqual(s.peaks.map((p) => p.name), ["Pet sim", "No project"]);
  assert.ok(s.peaks[0].h > s.peaks[1].h);
  assert.ok(heightAt(s.peaks, s.peaks[0].x, s.peaks[0].z) > heightAt(s.peaks, 30, 30));
  assert.equal(s.total, 330);
  assert.deepEqual(s.daily, [3]);
  assert.match(s.summary, /5 h 30 min/);
});

test("LIFE: habits only (journal ignored), done-today counts only habits due today", () => {
  const s = lifeScene({ habits: [{ id: "a", name: "Read", streak: 4, doneToday: true }, { id: "b", name: "Run", doneToday: false, scheduledToday: false }, { id: "c", name: "Off", off: true }],
    journal: [{ date: "2026-11-25", text: "private" }] });
  assert.equal(s.pods.length, 2);
  assert.equal(s.done, 1);
  assert.equal(s.due, 1);
  assert.ok(!JSON.stringify(s).includes("private"));
});

import { memoryClusters } from "../src/lib/planet-scenes-pure.ts";
test("MEMORY: a cluster per kind at its stars' middle, on ground below the lowest star; bad points skipped", () => {
  const s = memoryClusters([{ kind: "note", x: 0, y: 2, z: 0 }, { kind: "note", x: 4, y: -3, z: 2 }, { kind: "idea", x: -6, y: 1, z: 0 }, { kind: "idea", x: NaN, y: 0, z: 0 }]);
  assert.deepEqual(s.clusters.map((c) => [c.kind, c.count]), [["note", 2], ["idea", 1]]);
  assert.equal(s.ground, -8);
  assert.deepEqual([s.clusters[0].x, s.clusters[0].z], [2, 1]);
  assert.ok(s.clusters.every((c) => c.crystals.every((k) => k.at[1] === -8 && k.h > 0)));
  assert.equal(memoryClusters([]).clusters.length, 0);
});
