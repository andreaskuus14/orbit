import { test } from "node:test";
import assert from "node:assert/strict";
import { MINUTES_SAVED, operatorReport, suggestRaises } from "../src/lib/operator-pure.ts";
import { DEFAULT_LEVELS } from "../src/lib/autonomy-pure.ts";
import type { LedgerEvent } from "../src/lib/ledger-pure.ts";

const now = Date.parse("2026-10-25T17:00:00Z"); // Sunday 20:00 in Tallinn; week = Mon 19 Oct – Sun 25 Oct
let k = 0;
const e = (at: string, type: string, data: Record<string, unknown>) => ({ id: String(++k), at, type, planet: "core", data }) as LedgerEvent;
const events: LedgerEvent[] = [
  e("2026-10-18T10:00:00Z", "night.task", { night: "n0", kind: "research", ref: "r0", status: "done" }), // last week: ignored
  e("2026-10-20T01:00:00Z", "night.task", { night: "n1", kind: "research", ref: "t1", status: "done" }),
  e("2026-10-20T01:10:00Z", "night.task", { night: "n1", kind: "business", ref: "p1", status: "approval" }),
  e("2026-10-20T01:20:00Z", "night.task", { night: "n1", kind: "goal", ref: "g1", status: "failed" }),
  e("2026-10-20T04:00:00Z", "night.end", { night: "n1", done: 1, approvals: 1, failed: 1, calls: 5, minutes: 30 }),
  e("2026-10-21T09:00:00Z", "autonomy.act", { area: "studio-publish", action: "publish", ref: "job/c1" }),
  e("2026-10-21T09:00:00Z", "higgsfield.spend", { jobId: "h1", credits: 12.5, kind: "story" }),
  e("2026-10-22T09:00:00Z", "business.stage", { prospect: "p1", to: "replied" }),
  e("2026-10-22T09:00:00Z", "clip.outcome48h", { clipId: "job/c1", views: 1200, likes: 40 }),
  e("2026-10-23T02:00:00Z", "health.issue", { issue: "disk", status: "new" }),
  e("2026-10-23T03:00:00Z", "health.issue", { issue: "disk", status: "resolved" }),
  e("2026-10-23T03:00:00Z", "health.issue", { issue: "asr", status: "regressed" }),
  e("2026-10-24T03:00:00Z", "deal.hunt", { wishId: "w1", offers: 3, great: 1 }),
  e("2026-10-24T03:00:00Z", "deal.found", { wishId: "w1", offerId: "o1" }),
];

test("operator report: what ORBIT did, results, time saved, failures (ids only)", () => {
  const r = operatorReport({ now, events, levels: DEFAULT_LEVELS, lessons: [] });
  assert.equal(r.from, "2026-10-19");
  assert.equal(r.nights, 1);
  assert.equal(r.approvalsPrepared, 1);
  assert.deepEqual(r.did.map((d) => [d.key, d.count]), [["night.research", 1], ["health.fix", 1], ["night.business", 1], ["auto.publish", 1], ["deal.hunt", 1]]);
  assert.equal(r.savedMinutes, MINUTES_SAVED["night.research"] + MINUTES_SAVED["health.fix"] + MINUTES_SAVED["night.business"] + MINUTES_SAVED["auto.publish"] + MINUTES_SAVED["deal.hunt"]);
  assert.deepEqual({ ...r.money }, { credits: 12.5, spends: 1, replies: 1, pilots: 0, paying: 0, lost: 0, dealsFound: 1, shortsOut: 0, views: 1200, likes: 40 });
  assert.deepEqual(r.failed.map((f) => f.cite), ["event:night.task~4", "event:health.issue~12"]); // the resolved disk issue is a fix, not a failure
  assert.match(r.spoken, /^Operator report\. This week I handled 5 things on my own, which saved you about 45 min\./);
  assert.match(r.lines.join(" "), /12\.5 Higgsfield credits/);
  const empty = operatorReport({ now, events: [], levels: DEFAULT_LEVELS, lessons: [] });
  assert.deepEqual([empty.did, empty.failed, empty.suggest], [[], [], []]);
  assert.match(empty.lines[0], /didn't do anything/);
});

test("permissions I'd like next: suggested from his near-always-yes decisions, never applied, never spend or off", () => {
  const hy = (n: number, decision: string) => Array.from({ length: n }, (_, i) => e(`2026-10-${10 + i}T10:00:00Z`, "memory.hygiene", { action: "merge", decision, key: `m${i}` }));
  const levels = { ...DEFAULT_LEVELS, memory: "ask" as const };
  const s = suggestRaises({ now, events: hy(9, "accepted").concat(hy(1, "dismissed")), levels, lessons: [] });
  assert.deepEqual(s.map((x) => [x.area, x.from, x.to]), [["memory", "ask", "do"]]);
  assert.equal(s[0].cites.length, 8);
  assert.ok(s[0].cites.every((c) => /^event:memory\.hygiene~\d+$/.test(c)));
  assert.deepEqual(suggestRaises({ now, events: hy(4, "accepted"), levels, lessons: [] }), []); // too few decisions
  assert.deepEqual(suggestRaises({ now, events: hy(9, "accepted"), levels: DEFAULT_LEVELS, lessons: [] }), []); // already at its top level

  const lesson = (area: string, confidence: number, status = "kept", sign = 1) => ({ id: `L-${area}`, area, sign, confidence, status });
  const fromLessons = suggestRaises({ now, events: [], levels: DEFAULT_LEVELS, lessons: [lesson("clip.hookStyle", 0.95), lesson("outreach.angle", 0.99), lesson("proposal.agent", 0.8), lesson("clip.reason", 0.99)] });
  assert.deepEqual(fromLessons.map((x) => [x.area, x.to, x.cites[0]]), [["studio-publish", "auto", "lesson:L-clip.hookStyle"]]);
  assert.deepEqual(suggestRaises({ now, events: [], levels: { ...DEFAULT_LEVELS, "studio-publish": "off" }, lessons: [lesson("clip.kind", 0.99)] }), []); // off on purpose
  assert.deepEqual(suggestRaises({ now, events: [], levels: DEFAULT_LEVELS, lessons: [lesson("clip.kind", 0.99, "rejected")] }), []);
  assert.deepEqual(suggestRaises({ now, events: [], levels: DEFAULT_LEVELS, lessons: [lesson("clip.kind", 0.99, "kept", -1)] }), []);
  const r = operatorReport({ now, events: [], levels: DEFAULT_LEVELS, lessons: [lesson("clip.kind", 0.97)] });
  assert.match(r.spoken, /want to raise it to auto with limits\? Your call/);
});
