import { test } from "node:test";
import assert from "node:assert/strict";
import { ORBIT_R, activityFeed, agentStatus, currentTask, orbitPos, statusGlow, statusVisual, streamFrac, type StationTask } from "../src/lib/station-pure.ts";

const T = (id: string, agent: string, status: StationTask["status"], min: number, extra: Partial<StationTask> = {}): StationTask => ({
  id, agent, title: id, status, created_at: new Date(Date.UTC(2026, 0, 1, 0, min)).toISOString(), started_at: null, finished_at: null, ...extra,
});

test("agentStatus: waiting > working > failed > idle", () => {
  assert.equal(agentStatus([], "atlas"), "idle");
  assert.equal(agentStatus([], "atlas", 1), "working"); // delegated sub-task running
  assert.equal(agentStatus([T("a", "atlas", "failed", 5)], "atlas"), "failed");
  assert.equal(agentStatus([T("a", "atlas", "failed", 5), T("b", "atlas", "done", 1)], "atlas"), "failed");
  assert.equal(agentStatus([T("a", "atlas", "done", 5), T("b", "atlas", "failed", 1)], "atlas"), "idle"); // only the newest counts
  assert.equal(agentStatus([T("a", "atlas", "done", 9), T("b", "atlas", "queued", 1)], "atlas"), "working");
  assert.equal(agentStatus([T("a", "atlas", "running", 9), T("b", "atlas", "awaiting_approval", 1)], "atlas"), "waiting");
  assert.equal(agentStatus([T("a", "nova", "failed", 9)], "atlas"), "idle");
  assert.equal(currentTask([T("a", "atlas", "done", 9), T("b", "atlas", "running", 1)], "atlas")?.id, "b");
});

test("statusGlow: finite, non-negative, clamped; status colours", () => {
  for (const s of ["idle", "working", "waiting", "failed"] as const) {
    for (const t of [0, 0.3, 1.7, 1e9, NaN, -5, Infinity]) {
      const g = statusGlow(s, "#38bdf8", t);
      assert.ok(Number.isFinite(g.intensity) && g.intensity >= 0 && g.intensity <= 2, `${s} @ ${t}`);
    }
  }
  assert.equal(statusGlow("idle", "#38bdf8", 0).color, "#38bdf8");
  assert.ok(statusGlow("idle", "#38bdf8", 0).intensity < statusGlow("working", "#38bdf8", 0).intensity);
  assert.equal(statusGlow("waiting", "#38bdf8", 0).color, "#fbbf24");
  assert.notEqual(statusGlow("waiting", "#x", 0.1).intensity, statusGlow("waiting", "#x", 0.6).intensity); // blinks
  assert.equal(statusGlow("waiting", "#x", 0.6, true).intensity, statusGlow("waiting", "#x", 0.1, true).intensity); // reduced motion: steady
  assert.equal(statusGlow("failed", "#x", 0).color, "#ef4444");
});

test("activityFeed: newest first, capped, skips bad dates", () => {
  const iso = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString();
  const tasks = [
    T("a", "atlas", "done", 0, { started_at: iso(1), finished_at: iso(4) }),
    T("b", "nova", "awaiting_approval", 2, { started_at: iso(3), finished_at: iso(5) }),
    T("c", "qa", "queued", 6),
    { ...T("d", "qa", "queued", 0), created_at: "garbage" },
  ];
  const feed = activityFeed(tasks);
  assert.deepEqual(feed.map((e) => e.key), ["c:queued", "b:awaiting_approval", "a:done", "b:started", "b:queued", "a:started", "a:queued"]);
  assert.equal(activityFeed(tasks, 2).length, 2);
  const many = Array.from({ length: 30 }, (_, i) => T(`t${i}`, "atlas", "queued", i));
  assert.equal(activityFeed(many).length, 10);
  assert.equal(activityFeed(many)[0].key, "t29:queued");
});

test("orbitPos: finite, on its ring, writes into out", () => {
  const out = { x: 0, y: 0, z: 0 };
  for (const t of [0, 12.5, 1e9, NaN, Infinity]) {
    for (const i of [0, 1, 2, 5]) {
      assert.equal(orbitPos(i, 6, t, out), out);
      assert.ok([out.x, out.y, out.z].every(Number.isFinite), `${i} @ ${t}`);
      assert.ok(Math.abs(Math.hypot(out.x, out.z) - ORBIT_R[i % 2]) < 1e-9);
    }
  }
  orbitPos(0, 0, 0, out); // n = 0 must not divide by zero
  assert.ok(Number.isFinite(out.x));
});

test("statusVisual: clamped, working pulses + beams, waiting blinks, reduced is steady", () => {
  for (const s of ["idle", "working", "waiting", "failed"] as const) {
    for (const t of [0, 0.3, 1.7, 1e9, NaN, -5, Infinity]) {
      const v = statusVisual(s, t);
      assert.ok(Object.values(v).every((x) => Number.isFinite(x) && x >= 0), `${s} @ ${t}`);
      assert.ok(v.scale <= 1.5 && v.halo <= 0.8 && v.beam <= 1 && v.beacon <= 1);
    }
  }
  assert.ok(statusVisual("working", 0).beam > 0 && statusVisual("idle", 0).beam === 0);
  assert.ok(statusVisual("idle", 0).halo < statusVisual("working", 0).halo);
  assert.ok(statusVisual("idle", 0).scale < 1);
  assert.notEqual(statusVisual("waiting", 0.1).beacon, statusVisual("waiting", 0.6).beacon);
  assert.equal(statusVisual("waiting", 0.6, true).beacon, 1);
  assert.equal(statusVisual("working", 0.6, true).beamSpeed, 0);
  assert.equal(statusVisual("working", 0.2, true).scale, statusVisual("working", 0.9, true).scale);
  assert.equal(statusVisual("idle", 0).beacon, 0);
});

test("streamFrac: in [0, 1), spaced, advances", () => {
  for (const t of [0, 3.3, -2, 1e9, NaN]) for (let k = 0; k < 8; k++) { const f = streamFrac(k, 8, t, 0.6); assert.ok(f >= 0 && f < 1, `${k} @ ${t}`); }
  assert.equal(streamFrac(2, 8, 0, 1), 0.25);
  assert.ok(Math.abs(streamFrac(0, 8, 0.5, 0.5) - 0.25) < 1e-12);
  assert.equal(streamFrac(1, 0, 0, NaN), 0);
});
