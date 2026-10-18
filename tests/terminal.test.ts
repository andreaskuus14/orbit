import { test } from "node:test";
import assert from "node:assert/strict";
import { activityLines, agentLines, appendNew, busyLines, clock, doctorLines, goalLines, statsLine, uptime, usageLines } from "../src/lib/terminal-pure.ts";

const t = new Date(2026, 0, 1, 12, 1, 33).getTime();

test("clock and uptime", () => {
  assert.equal(clock(t), "12:01:33");
  assert.equal(clock("nope"), "--:--:--");
  assert.equal(uptime(3_723_000), "01:02:03");
  assert.equal(uptime(90_061_000), "1d 01:01:01");
});

test("activity: oldest first, stamped, junk skipped", () => {
  const at = new Date(t).toISOString();
  const l = activityLines({ items: [{ at, area: "agents", title: "Research X", detail: "done" }, { at, area: "goals" }, null] });
  assert.equal(l.length, 1);
  assert.equal(l[0].text, "[12:01:33] agents ▶ Research X — done");
  assert.deepEqual(activityLines(null), []);
});

test("snapshot formatters", () => {
  assert.equal(usageLines({ h5: { calls: 3, tokens: 12000 }, level: { pct: 40, heavy: false }, hold: "" }, t)[0].body, "usage ▶ 5h 3 calls · 12,000 tok · 40%");
  assert.equal(usageLines({ h5: {}, level: {}, hold: "Heavy" }, t).length, 2);
  const d = doctorLines({ report: { status: "warn", headline: "1 issue", checks: [{ id: "disk", status: "warn", detail: "low" }, { id: "ok", status: "ok", detail: "" }] } }, t);
  assert.deepEqual(d.map((x) => x.body), ["doctor ! 1 issue", "doctor:disk ! low"]);
  const a = agentLines({ agents: { atlas: { running: 2, done: 3, failed: 1 }, nova: { awaiting: 1, done: 1 } } }, t);
  assert.deepEqual(a.map((x) => x.body), ["agents ▶ 30d 4 done · 1 failed", "agent:atlas ▶ running ×2", "agent:nova ⏸ awaiting approval"]);
  assert.equal(busyLines({ busy: true, clips: true, scout: false }, t)[0].body, "studio ▶ busy: clips");
  assert.equal(busyLines({ error: "localhost only" }, t)[0].body, "studio ✖ localhost only");
  assert.deepEqual(goalLines({ goals: [{ id: "g", title: "Ship", status: "running", progress: { pct: 49.6 } }, { id: "h", title: "Old", status: "done" }] }, t).map((x) => x.body), ["goal ▶ Ship [running] 50%"]);
  assert.equal(statsLine(1000, { level: { pct: 5 } }, { agents: { a: { running: 1 } } }, { report: { status: "ok" } }), "up 00:00:01 · agents 1 running · usage 5% · health ok");
});

test("appendNew prints a line again only when its body changes", () => {
  const last = new Map<string, string>();
  let log = appendNew([], last, busyLines({ busy: false }, t));
  log = appendNew(log, last, busyLines({ busy: false }, t + 1000));
  assert.equal(log.length, 1);
  log = appendNew(log, last, busyLines({ busy: true, clips: true }, t));
  assert.equal(log.length, 2);
  assert.equal(appendNew(log, last, busyLines({ busy: false }, t), 2).length, 2);
});
