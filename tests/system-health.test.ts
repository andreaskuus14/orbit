import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIRM, ackIncident, budget, failedJobs, mergeServices, modelRows, parseStore, problems, reconcile, sortIncidents, storageRow, type Incident, type Svc } from "../src/lib/system-health-pure.ts";
import { pushLabel } from "../src/lib/remote-push-pure.ts";

const T = Date.parse("2026-10-27T12:00:00Z"), M = 60_000, GB = 1024 ** 3;
const P = (key: string) => ({ key, title: key });
const run = (prev: Incident[], keys: string[], at: number, quiet = false) => reconcile(prev, keys.map(P), at, quiet);

test("incident: opens, alerts once after CONFIRM checks, stays one per key", () => {
  assert.equal(CONFIRM, 2);
  let r = run([], ["svc:supabase"], T);
  assert.equal(r.incidents.length, 1);
  assert.equal(r.incidents[0].state, "open");
  assert.equal(r.alert.length, 0, "one blip is not alerted");
  r = run(r.incidents, ["svc:supabase", "svc:supabase"], T + 10 * M); // duplicate problems dedupe by key
  assert.equal(r.incidents.length, 1);
  assert.equal(r.alert.length, 1);
  assert.ok(r.incidents[0].alertedAt);
  r = run(r.incidents, ["svc:supabase"], T + 20 * M);
  assert.equal(r.alert.length, 0, "never twice for the same incident");
  assert.equal(r.incidents[0].seen, 3);
});

test("incident: auto-resolves when gone; coming back is a new incident that alerts again", () => {
  let r = run(run([], ["disk:vault"], T).incidents, ["disk:vault"], T + M);
  assert.equal(r.alert.length, 1);
  r = run(r.incidents, [], T + 2 * M);
  assert.equal(r.incidents[0].state, "resolved");
  assert.ok(r.incidents[0].resolvedAt);
  r = run(r.incidents, ["disk:vault"], T + 3 * M);
  assert.equal(r.incidents.length, 2);
  assert.deepEqual(r.incidents.map((i) => i.state).sort(), ["open", "resolved"]);
  r = run(r.incidents, ["disk:vault"], T + 4 * M);
  assert.equal(r.alert.length, 1);
});

test("incident: quiet hours hold the alert until they end; acknowledged ones never alert but still resolve", () => {
  let r = run(run([], ["claude:limit"], T, true).incidents, ["claude:limit"], T + M, true);
  assert.equal(r.alert.length, 0);
  r = run(r.incidents, ["claude:limit"], T + 2 * M, false);
  assert.equal(r.alert.length, 1, "alerted once quiet hours are over");

  const acked = ackIncident(run([], ["svc:calendar"], T).incidents, "svc:calendar");
  assert.equal(acked[0].state, "ack");
  r = run(acked, ["svc:calendar"], T + M);
  assert.equal(r.alert.length, 0);
  assert.equal(r.incidents[0].state, "ack");
  r = run(r.incidents, [], T + 2 * M);
  assert.equal(r.incidents[0].state, "resolved");
  assert.equal(ackIncident(r.incidents, "svc:calendar")[0].state, "resolved", "ack never reopens a resolved one");
});

test("incident: resolved history is kept a week, then dropped; sort puts open first", () => {
  const r = run(run([], ["a"], T).incidents, [], T + M);
  assert.equal(run(r.incidents, [], T + 6 * 86_400_000).incidents.length, 1);
  assert.equal(run(r.incidents, [], T + 8 * 86_400_000).incidents.length, 0);
  const mixed = run(run([], ["x", "y"], T).incidents, ["y", "z"], T + M).incidents;
  assert.deepEqual(sortIncidents(ackIncident(mixed, "y")).map((i) => `${i.key}:${i.state}`), ["z:open", "y:ack", "x:resolved"]);
});

test("problems: down services, full drives and an active usage limit", () => {
  const svc = (id: string, state: Svc["state"]): Svc => ({ id, label: id, state, detail: "", lastOk: null });
  const ps = problems([svc("supabase", "down"), svc("resend", "off"), svc("ollama", "ok")],
    [storageRow("vault", "VAULT", "/v", 2 * GB), storageRow("data", "Data", "/d", 50 * GB)], T + 3600_000);
  assert.deepEqual(ps.map((p) => p.key), ["svc:supabase", "disk:vault", "claude:limit"]);
  assert.deepEqual(problems([], [], null), []);
});

test("services: last success only moves forward", () => {
  const a = mergeServices([{ id: "db", label: "DB", state: "ok", detail: "", okAt: "2026-10-27T10:00:00Z" }], {});
  assert.equal(a.services[0].lastOk, "2026-10-27T10:00:00Z");
  const b = mergeServices([{ id: "db", label: "DB", state: "down", detail: "", okAt: null }, { id: "x", label: "X", state: "off", detail: "" }], a.lastOk);
  assert.equal(b.services[0].lastOk, "2026-10-27T10:00:00Z");
  assert.equal(b.services[1].lastOk, null);
  assert.equal(mergeServices([{ id: "db", label: "DB", state: "ok", detail: "", okAt: "2026-10-01T00:00:00Z" }], a.lastOk).lastOk.db, "2026-10-27T10:00:00Z");
});

test("failed jobs: last 7 days per kind, newest first, zeros listed", () => {
  const f = failedJobs([
    { kind: "task", label: "old", at: new Date(T - 8 * 86_400_000).toISOString() },
    { kind: "task", label: "a", at: new Date(T - M).toISOString() },
    { kind: "task", label: "b", at: new Date(T - 2 * M).toISOString() },
    { kind: "clip", label: "c", at: new Date(T - 3 * M).toISOString() },
  ], T);
  assert.deepEqual(f.map((g) => [g.kind, g.count]), [["task", 2], ["mission", 0], ["night", 0], ["clip", 1]]);
  assert.deepEqual(f[0].recent.map((x) => x.label), ["a", "b"]);
});

test("storage, models and budgets", () => {
  assert.equal(storageRow("s", "S", "/s", 3 * GB).status, "fail");
  assert.equal(storageRow("s", "S", "/s", 10 * GB).status, "warn");
  assert.equal(storageRow("s", "S", "/s", 100 * GB).status, "ok");
  assert.equal(storageRow("s", "S", "/s", null).status, "warn");
  const calls = [{ at: T - 3 * M, model: "sonnet", ok: true }, { at: T - 2 * M, model: "opus", ok: true }, { at: T - M, model: "opus", ok: false }];
  const rows = modelRows({ main: "sonnet", deep: "opus", fast: "haiku", none: "" }, calls, false, T);
  assert.deepEqual(rows.map((r) => [r.role, r.state, r.calls7d]), [["main", "ok", 1], ["deep", "failing", 2], ["fast", "unused", 0]]);
  assert.equal(rows[1].lastOk, T - 2 * M);
  assert.ok(modelRows({ main: "sonnet" }, calls, true, T).every((r) => r.state === "limited"));
  assert.deepEqual(budget(30, 150), { used: 30, cap: 150, pct: 20 });
  assert.deepEqual(budget(30, null), { used: 30, cap: null, pct: null });
});

test("store parsing drops junk; the health push is a fixed label", () => {
  assert.deepEqual(parseStore("nope"), { lastOk: {}, incidents: [], lastCheck: 0 });
  const good = run([], ["k"], T).incidents[0];
  const s = parseStore(JSON.stringify({ lastOk: { a: "x", b: 1 }, incidents: [good, { key: 1 }, null], lastCheck: 5 }));
  assert.deepEqual(s.lastOk, { a: "x" });
  assert.equal(s.incidents.length, 1);
  assert.equal(s.lastCheck, 5);
  const m = pushLabel("health", 2);
  assert.equal(m.tag, "health");
  assert.match(m.title, /2 ORBIT problems/);
});
