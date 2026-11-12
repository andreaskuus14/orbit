import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SHIPS, T, reconcileShips, shipFrame, shipStatus, shipTarget, type Ship } from "../src/lib/ships-pure.ts";

const task = (id: string, status = "running", title = "Do a thing", agent = "nova") => ({ id, title, agent, status });
const finite = (f: ReturnType<typeof shipFrame>) => { for (const v of [f.u, f.alpha, f.amber, f.red]) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, String(v)); };

test("ships: target from keywords, then agent, then AGENTS", () => {
  assert.equal(shipTarget({ title: "Script for my next YouTube video", agent: "forge" }), "studio");
  assert.equal(shipTarget({ title: "Fix the Roblox pet bug", agent: "atlas" }), "creation");
  assert.equal(shipTarget({ title: "Look into this", agent: "Atlas" }), "intelligence");
  assert.equal(shipTarget({ title: "Organise", agent: "echo" }), "memory");
  assert.equal(shipTarget({ title: "Plan the week", agent: "nova" }), "agents");
  assert.equal(shipTarget({ title: "", agent: "" }), "agents");
});

test("ships: status mapping", () => {
  assert.equal(shipStatus("queued"), null);
  assert.equal(shipStatus("cancelled"), "done");
  assert.equal(shipStatus("awaiting_approval"), "awaiting_approval");
});

test("ships: launch → cruise → dock → return → gone", () => {
  const s: Ship = { id: "a", title: "t", target: "studio", status: "running", launchedAt: 0, endedAt: null };
  const f0 = shipFrame(s, 0, false), f1 = shipFrame(s, T.launch + 10, false), f2 = shipFrame(s, T.launch + T.cruise + 1, false);
  assert.equal(f0.phase, "launch"); assert.equal(f0.u, 0);
  assert.equal(f1.phase, "cruise"); assert.ok(f1.u > 0 && f1.u < 1);
  assert.equal(f2.phase, "dock"); assert.equal(f2.u, 1);
  const done = { ...s, status: "failed" as const, endedAt: 10_000 };
  const r = shipFrame(done, 10_000, false);
  assert.equal(r.phase, "return"); assert.equal(r.u, 1); assert.equal(r.red, 1); assert.equal(r.alpha, 1);
  const mid = shipFrame(done, 10_000 + T.ret * 0.75, false);
  assert.ok(mid.u < 1 && mid.alpha < 1 && mid.red === 0);
  assert.equal(shipFrame(done, 10_000 + T.ret, false).phase, "gone");
  for (let t = -5000; t < 20_000; t += 137) { finite(shipFrame(s, t, false)); finite(shipFrame(done, t, false)); finite(shipFrame(done, t, true)); }
  finite(shipFrame({ ...s, launchedAt: NaN }, 5, false));
});

test("ships: reduced motion appears docked, fades in place", () => {
  const s: Ship = { id: "a", title: "t", target: "studio", status: "awaiting_approval", launchedAt: 0, endedAt: null };
  assert.deepEqual(shipFrame(s, 0, true), { phase: "dock", u: 1, alpha: 1, amber: 1, red: 0 });
  assert.equal(shipFrame({ ...s, endedAt: 100 }, 100 + T.ret * 0.9, true).u, 1);
});

test("ships: reconcile launches, updates, returns, prunes and caps", () => {
  let f = reconcileShips([], [task("a"), task("q", "queued"), task("d", "done")], 0);
  assert.deepEqual(f.map((s) => s.id), ["a"]); // queued and already-finished tasks don't launch
  f = reconcileShips(f, [task("a", "awaiting_approval", "Renamed")], 100);
  assert.equal(f[0].status, "awaiting_approval"); assert.equal(f[0].title, "Renamed"); assert.equal(f[0].launchedAt, 0);
  f = reconcileShips(f, [], 200); // vanished from the snapshot → flies home as done
  assert.equal(f[0].status, "done"); assert.equal(f[0].endedAt, 200);
  f = reconcileShips(f, [task("a", "failed")], 300);
  assert.equal(f[0].status, "done"); assert.equal(f[0].endedAt, 200); // an ended ship keeps its ending
  assert.equal(reconcileShips(f, [], 200 + T.ret).length, 0);
  const many = reconcileShips([], Array.from({ length: 20 }, (_, i) => task(`t${i}`)), 0);
  assert.equal(many.length, MAX_SHIPS); assert.equal(many.at(-1)!.id, "t19");
});
