import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES, fromRows, isoMs, ledgerIssue, stateAt, validate, type LedgerEvent } from "../src/lib/ledger-pure.ts";

const DATA: Record<string, object> = {
  "core.turn": { model: "sonnet", tools: 2, ms: 900 },
  "tool.call": { tool: "web_search", ok: true, ms: 1200 },
  "memory.saved": { memoryId: "m1", kind: "note" },
  "clip.published": { clipId: "c1", title: "Big play" },
  "clip.outcome48h": { clipId: "c1", views: 5000, likes: 300 },
  "clip.postmortem": { clipId: "j/c1", drops: 2, hold3s: 0.82 },
  "business.stage": { prospect: "Cafe Roma", to: "contacted" },
  "goal.step": { goalId: "g1", step: "Draft titles", status: "done" },
  "life.habit": { habit: "Run", done: true },
  "focus.session": { minutes: 25 },
  "notify.shown": { kind: "reminder", title: "Call mom" },
  "morning.thumb": { kind: "news", key: "news:Markets dip", up: false },
  "policy.decision": { tool: "save_memory", tier: "T2", verdict: "allow", reason: "allowed" },
  "morning.click": { source: "studio", key: "studio:review" },
  "morning.done": { source: "devworld", key: "bug:b1" },
  "journal.saved": { memoryId: "m2" },
  "higgsfield.spend": { jobId: "mf1-abc123", credits: 4.5, kind: "draft" },
  "memory.hygiene": { action: "merge", decision: "accepted", key: "merge:a:b" },
};
let n = 0;
const ev = (type: string, at: string, data: object = DATA[type], extra: object = {}) => {
  const r = validate({ id: `e${++n}`, at, type, planet: "core", data, ...extra });
  if ("error" in r) throw new Error(r.error);
  return r.ok;
};
const err = (o: object) => { const r = validate(o); assert.ok("error" in r, JSON.stringify(o)); return (r as { error: string }).error; };
const base = { id: "x", at: "2026-10-23T10:00:00Z", type: "focus.session", planet: "life", data: { minutes: 25 } };
const shuffle = <T>(xs: T[], seed: number) => xs.map((x, i) => ({ x, k: Math.sin(seed * 997 + i) })).sort((a, b) => a.k - b.k).map((p) => p.x);

test("validate: every type accepts its data shape and drops unknown fields", () => {
  for (const type of EVENT_TYPES) assert.ok("ok" in validate({ ...base, type, data: DATA[type] }), type);
  const r = validate({ ...base, data: { minutes: 10, secret: "x" }, caused_by: "y", junk: 1 });
  assert.deepEqual(r, { ok: { id: "x", at: base.at, type: "focus.session", planet: "life", data: { minutes: 10 }, caused_by: "y" } });
});

test("validate: unknown types, planets and bad envelopes", () => {
  assert.match(err(null as unknown as object), /object/);
  assert.match(err([]), /object/);
  assert.match(err({ ...base, type: "clip.deleted" }), /unknown type "clip.deleted"/);
  assert.match(err({ ...base, type: "__proto__" }), /unknown type/);
  assert.match(err({ ...base, type: "toString" }), /unknown type/);
  assert.match(err({ ...base, planet: "pluto" }), /planet/);
  assert.match(err({ ...base, id: "" }), /id/);
  assert.match(err({ ...base, id: 7 }), /id/);
  assert.match(err({ ...base, caused_by: "x" }), /cause itself/);
  assert.match(err({ ...base, caused_by: 3 }), /caused_by/);
  assert.match(err({ ...base, data: null }), /data/);
  assert.match(err({ ...base, data: [] }), /data/);
});

test("validate: per-type data checks", () => {
  assert.match(err({ ...base, data: { minutes: 0 } }), /data.minutes/);
  assert.match(err({ ...base, data: { minutes: 2000 } }), /data.minutes/);
  assert.match(err({ ...base, type: "clip.outcome48h", data: { clipId: "c", views: -1, likes: 0 } }), /data.views/);
  assert.match(err({ ...base, type: "clip.outcome48h", data: { clipId: "c", views: 1.5, likes: 0 } }), /data.views/);
  assert.match(err({ ...base, type: "business.stage", data: { prospect: "A", to: "won" } }), /data.to/);
  assert.match(err({ ...base, type: "goal.step", data: { goalId: "g", step: "s", status: "done", goalDone: "yes" } }), /goalDone/);
  assert.match(err({ ...base, type: "tool.call", data: { tool: "x", ok: "true", ms: 1 } }), /data.ok/);
  assert.match(err({ ...base, type: "notify.shown", data: { kind: "r", title: "x".repeat(201) } }), /data.title/);
});

test("validate: bad dates", () => {
  for (const at of ["2026-10-23", "2026-10-23T10:00:00", "yesterday", "2026-02-30T10:00:00Z", "2026-13-01T00:00:00Z", "2026-10-23T25:00:00Z", 1761213600000, ""]) {
    assert.match(err({ ...base, at }), /at must be/, String(at));
  }
  for (const at of ["2026-10-23T10:00Z", "2026-10-23T10:00:00.123Z", "2026-10-23T13:00:00+03:00", "2024-02-29T00:00:00Z"]) assert.ok("ok" in validate({ ...base, at }), at);
  assert.equal(isoMs("2026-10-23T13:00:00+03:00"), isoMs("2026-10-23T10:00:00Z"));
});

const log = (): LedgerEvent[] => [
  ev("focus.session", "2026-10-20T09:00:00Z", { minutes: 25 }),
  ev("focus.session", "2026-10-21T09:00:00Z", { minutes: 50 }),
  ev("focus.session", "2026-10-23T09:00:00Z", { minutes: 30 }),
  ...[1, 2, 3, 4, 5, 6, 7].map((i) => ev("clip.outcome48h", `2026-10-1${i}T12:00:00Z`, { clipId: `c${i}`, views: i * 100, likes: i })),
  ev("business.stage", "2026-10-10T10:00:00Z", { prospect: "Cafe", to: "lead" }),
  ev("business.stage", "2026-10-12T10:00:00Z", { prospect: "Cafe", to: "contacted" }),
  ev("business.stage", "2026-10-22T10:00:00Z", { prospect: "Cafe", to: "replied" }),
  ev("business.stage", "2026-10-11T10:00:00Z", { prospect: "Gym", to: "lead" }),
  ev("goal.step", "2026-10-15T10:00:00Z", { goalId: "g1", step: "a", status: "started" }),
  ev("goal.step", "2026-10-16T10:00:00Z", { goalId: "g2", step: "a", status: "done" }),
  ev("goal.step", "2026-10-21T10:00:00Z", { goalId: "g2", step: "b", status: "done", goalDone: true }),
  ev("notify.shown", "2026-10-22T08:00:00Z"),
];

test("stateAt: counts, last 5 clip outcomes, stages, goals and focus at a point in time", () => {
  const s = stateAt(log(), "2026-10-21T23:59:59Z");
  assert.equal(s.counts["focus.session"], 2);
  assert.equal(s.counts["notify.shown"], 0);
  assert.equal(s.focusMinutes, 75);
  assert.deepEqual(s.lastClipOutcomes.map((c) => c.clipId), ["c7", "c6", "c5", "c4", "c3"]);
  assert.deepEqual(s.lastClipOutcomes[0], { clipId: "c7", views: 700, likes: 7, at: "2026-10-17T12:00:00Z" });
  assert.deepEqual(s.businessStages, { lead: 1, contacted: 1, replied: 0, pilot: 0, paying: 0, lost: 0 });
  assert.deepEqual(s.activeGoals, ["g1"]);
  const later = stateAt(log(), "2026-10-23T09:00:00Z"); // inclusive bound
  assert.equal(later.focusMinutes, 105);
  assert.equal(later.businessStages.replied, 1);
  assert.equal(later.counts["notify.shown"], 1);
  const early = stateAt(log(), "2026-10-15T10:00:00Z");
  assert.deepEqual(early.activeGoals, ["g1"]);
  assert.deepEqual(early.lastClipOutcomes.map((c) => c.clipId), ["c4", "c3", "c2", "c1"]); // c5 lands at 12:00
  assert.deepEqual(stateAt(log(), "2026-10-16T10:00:00Z").activeGoals, ["g1", "g2"]);
  assert.equal(stateAt(log(), Date.parse("2026-10-21T00:00:00Z")).focusMinutes, 25); // ms works too
  assert.equal(stateAt([], "2026-10-21T00:00:00Z").focusMinutes, 0);
  assert.deepEqual(stateAt(log(), "not a date").counts["focus.session"], 0); // bad t = nothing is at or before it
});

test("stateAt: out-of-order input gives the same snapshot", () => {
  const events = log(), want = stateAt(events, "2026-10-22T12:00:00Z");
  for (const seed of [1, 2, 3, 4, 5]) assert.deepEqual(stateAt(shuffle(events, seed), "2026-10-22T12:00:00Z"), want);
  assert.deepEqual(stateAt([...events].reverse(), "2026-10-22T12:00:00Z"), want);
  // equal timestamps: latest stage resolves by id, not by array position
  const a = ev("business.stage", "2026-10-01T00:00:00Z", { prospect: "Bar", to: "lead" }, { id: "s1" });
  const b = ev("business.stage", "2026-10-01T00:00:00Z", { prospect: "Bar", to: "lost" }, { id: "s2" });
  assert.deepEqual(stateAt([a, b], "2026-10-02T00:00:00Z").businessStages, stateAt([b, a], "2026-10-02T00:00:00Z").businessStages);
  assert.equal(stateAt([b, a], "2026-10-02T00:00:00Z").businessStages.lost, 1);
  // same instant in different zones counts as the same time
  const z = ev("focus.session", "2026-10-01T03:00:00+03:00", { minutes: 5 });
  assert.equal(stateAt([z], "2026-10-01T00:00:00Z").focusMinutes, 5);
});

test("stateAt: duplicate ids count once, keeping the earliest copy, in any order", () => {
  const first = ev("focus.session", "2026-10-01T00:00:00Z", { minutes: 10 }, { id: "dup" });
  const again = ev("focus.session", "2026-10-02T00:00:00Z", { minutes: 99 }, { id: "dup" });
  const same = ev("focus.session", "2026-10-01T00:00:00Z", { minutes: 10 }, { id: "dup" });
  for (const xs of [[first, again, same], [again, same, first], [same, again, first]]) {
    const s = stateAt(xs, "2026-10-03T00:00:00Z");
    assert.equal(s.counts["focus.session"], 1);
    assert.equal(s.focusMinutes, 10);
  }
  // on its own the later copy is just an event
  assert.equal(stateAt([again], "2026-10-03T00:00:00Z").focusMinutes, 99);
  // a same-time conflict resolves by content, not position
  const x = ev("focus.session", "2026-10-01T00:00:00Z", { minutes: 1 }, { id: "c" }), y = ev("focus.session", "2026-10-01T00:00:00Z", { minutes: 2 }, { id: "c" });
  assert.equal(stateAt([x, y], "2026-10-02T00:00:00Z").focusMinutes, stateAt([y, x], "2026-10-02T00:00:00Z").focusMinutes);
});

test("stateAt: caused_by cycles are ignored, plain chains and missing causes are kept", () => {
  const t = "2026-10-01T00:00:00Z", at = "2026-10-02T00:00:00Z";
  const turn = ev("core.turn", t, undefined, { id: "t1" });
  const call = ev("tool.call", t, undefined, { id: "c1", caused_by: "t1" });
  const saved = ev("memory.saved", t, undefined, { id: "m1", caused_by: "c1" });
  const orphan = ev("notify.shown", t, undefined, { id: "n1", caused_by: "gone" });
  const a = ev("focus.session", t, { minutes: 5 }, { id: "a", caused_by: "b" });
  const b = ev("focus.session", t, { minutes: 7 }, { id: "b", caused_by: "a" });
  const intoLoop = ev("life.habit", t, undefined, { id: "h", caused_by: "a" });
  for (const xs of [[turn, call, saved, orphan, a, b, intoLoop], [intoLoop, b, a, orphan, saved, call, turn]]) {
    const s = stateAt(xs, at);
    assert.equal(s.counts["core.turn"] + s.counts["tool.call"] + s.counts["memory.saved"] + s.counts["notify.shown"], 4);
    assert.equal(s.counts["focus.session"], 0);
    assert.equal(s.focusMinutes, 0);
    assert.equal(s.counts["life.habit"], 0); // its chain runs into the loop
  }
  // a cause that only exists after t can't close a loop at t
  const late = ev("focus.session", "2026-10-05T00:00:00Z", { minutes: 1 }, { id: "late", caused_by: "early" });
  const early = ev("focus.session", t, { minutes: 3 }, { id: "early", caused_by: "late" });
  assert.equal(stateAt([late, early], at).focusMinutes, 3);
  assert.equal(stateAt([late, early], "2026-10-06T00:00:00Z").focusMinutes, 0);
});

test("ledgerIssue: plain events pass, ledger types are checked", () => {
  assert.equal(ledgerIssue("core.started", "core", { conversationId: "x" }), null);
  assert.equal(ledgerIssue("focus.session", "life", { minutes: 25 }), null);
  assert.equal(ledgerIssue("clip.published", "studio", { clipId: "j1/c1" }), null); // title is optional
  assert.match(ledgerIssue("focus.session", "life", { minutes: 0 })!, /minutes/);
  assert.match(ledgerIssue("focus.session", "nowhere", { minutes: 5 })!, /planet/);
  assert.match(ledgerIssue("focus.session", "life", { minutes: 5 }, "")!, /caused_by/);
});

test("fromRows: Postgres rows → ledger events; legacy and bad rows skipped", () => {
  const evs = fromRows([
    { id: 7, created_at: "2026-10-20T10:00:00.123456+00:00", type: "focus.session", planet: "life", payload: { minutes: 25 }, caused_by: null },
    { id: 8, created_at: "2026-10-20T11:00:00+00:00", type: "clip.outcome48h", planet: "studio", payload: { clipId: "j/c", views: 10, likes: 1 }, caused_by: 7 },
    { id: 9, created_at: "2026-10-20T12:00:00Z", type: "core.started", planet: "core", payload: {} },
    { id: 10, created_at: "nope", type: "focus.session", planet: "life", payload: { minutes: 5 } },
    { id: 11, created_at: "2026-10-20T12:00:00Z", type: "focus.session", planet: "life", payload: { minutes: -1 } },
  ]);
  assert.deepEqual(evs.map((e) => [e.id, e.at, e.caused_by]), [["7", "2026-10-20T10:00:00.123Z", undefined], ["8", "2026-10-20T11:00:00.000Z", "7"]]);
  assert.equal(stateAt(evs, "2026-10-21T00:00:00Z").focusMinutes, 25);
});
