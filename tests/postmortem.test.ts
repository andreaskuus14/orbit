import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeRetention } from "../src/lib/retention-pure.ts";
import { buildPostMortem, clipTranscript, decideRule, emptyPostmortem, pmLine, pmMorning, postmortemDue, postmortemProblem, retentionPoints, rulesText,
  type PostMortemState } from "../src/lib/clips/postmortem-pure.ts";

const H = 3_600_000, now = Date.parse("2026-10-24T12:00:00Z");
const rec = (id: string, ageH: number) => ({ videoId: id, title: `T ${id}`, publishedAt: new Date(now - ageH * H).toISOString(), durationSec: 30 });

test("due: 48 h to 7 days old, not done, not tried in 6 h, oldest first, capped", () => {
  const s: PostMortemState = { ...emptyPostmortem(), items: [{ videoId: "done", title: "", at: "", durationSec: 30, hold3s: 1, hold30s: null, drops: [], rule: null, ruleStatus: null }],
    tries: { tried: { n: 1, at: new Date(now - 2 * H).toISOString() }, old: { n: 1, at: new Date(now - 7 * H).toISOString() } } };
  const due = postmortemDue([rec("young", 47), rec("a", 50), rec("done", 60), rec("tried", 60), rec("old", 70), rec("b", 100), rec("stale", 24 * 8), rec("c", 49)], s, now);
  assert.deepEqual(due.map((r) => r.videoId), ["b", "old", "a"]);
});

test("transcript: clip words regrouped into ~3 s segments on the Short's clock", () => {
  const words = [{ start: 99, end: 100, text: "before" }, { start: 100, end: 100.5, text: "wait" }, { start: 101, end: 101.5, text: "for" }, { start: 104, end: 105, text: "it" }, { start: 131, end: 132, text: "after" }];
  assert.deepEqual(clipTranscript(words, 100, 130), [{ start: 0, end: 1.5, text: "wait for" }, { start: 4, end: 5, text: "it" }]);
});

test("post-mortem: hook hold, biggest drop mapped to words, one proposed rule; empty curve waits", () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({ elapsedVideoTimeRatio: i / 100, audienceWatchRatio: i < 40 ? 0.9 : i < 50 ? 0.9 - (i - 40) * 0.04 : 0.5 }));
  rows.push({ elapsedVideoTimeRatio: "x" as unknown as number, audienceWatchRatio: 1 });
  const points = retentionPoints(rows);
  assert.equal(points.length, 101);
  const r = analyzeRetention({ duration: 30, points, transcript: [{ start: 12, end: 15, text: "and then nothing happens" }] });
  const pm = buildPostMortem(rec("a", 50), r, "2026-10-24T12:00:00Z")!;
  assert.equal(pm.ruleStatus, "proposed");
  assert.ok(pm.rule);
  assert.equal(pm.drops[0].label, '"and then nothing happens"');
  assert.match(pmLine(pm), /hook held 90% at 3 s · biggest drop 1\d s–1\d s \(−4\d%\) at "and then nothing happens"/);
  assert.equal(buildPostMortem(rec("a", 50), analyzeRetention({ duration: 30, points: [] }), "x"), null);
});

test("rules: only the owner's click adds one; dismiss and repeats never change accepted rules", () => {
  const p = { videoId: "a", title: "", at: "", durationSec: 30, hold3s: 0.9, hold30s: null, drops: [], rule: "Test moving the first payoff into the opening 3 seconds.", ruleStatus: "proposed" as const };
  const s0: PostMortemState = { ...emptyPostmortem(), items: [p, { ...p, videoId: "b", rule: "test moving the first payoff into the opening 3 seconds" }],
    rules: [{ text: "Keep it short.", videoId: "z", at: "t0" }] };
  assert.equal(pmMorning(s0), "2 post-mortem rules to review.");
  const s1 = decideRule(s0, "a", "accept", "t1")!;
  assert.deepEqual(s1.rules.map((r) => r.text), ["Keep it short.", p.rule]);
  assert.equal(decideRule(s1, "a", "accept", "t2"), null); // already decided
  const s2 = decideRule(s1, "b", "accept", "t2")!; // same rule again: not duplicated
  assert.equal(s2.rules.length, 2);
  const s3 = decideRule({ ...s0 }, "a", "dismiss", "t1")!;
  assert.deepEqual(s3.rules, s0.rules);
  assert.equal(decideRule(s0, "nope", "accept", "t"), null);
  assert.match(rulesText(s1), /Keep it short\. Test moving/);
  assert.equal(rulesText(null), "");
  assert.equal(postmortemProblem(s1), "");
  assert.notEqual(postmortemProblem({ v: 1 }), "");
});
