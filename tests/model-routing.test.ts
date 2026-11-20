import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FAST_PURPOSES, PROTECTED, routeFast, routedModel } from "../src/lib/model-routing-pure.ts";
import { FOCUS_GAP, FOCUS_MAX, focusTranscript, promptTranscript, type Word } from "../src/lib/clips/pure.ts";

test("the fast table is exactly the reviewed background purposes", () => {
  assert.deepEqual([...FAST_PURPOSES].sort(), ["clips.description", "clips.suggest", "pulse.evening", "pulse.midday", "pulse.morning"]);
  for (const p of FAST_PURPOSES) assert.ok(routeFast(p), p);
});

test("CORE answers, agents, drafts/sends, reviews, security and Opus judgement calls never route to Haiku", () => {
  for (const p of ["core", "core.chat", "agent.atlas", "agent.nova.review", "business.send", "business.draft", "clips.engage", "clips.rank", "clips.study", "clips.find", "clips.publish", "scout.niche", "security.scan", "pulse.weekly", "pulse.manual", "business.lead-check", "ideas.radar", "unknown", ""])
    assert.equal(routeFast(p), false, p);
  for (const p of ["core", "agent.x", "business.send", "clips.engage", "clips.rank", "scout.niche", "x.review", "x.guard", "x.check"]) assert.match(p, PROTECTED);
  for (const p of FAST_PURPOSES) assert.doesNotMatch(p, PROTECTED);
});

test("an explicit model always wins; the kill switch turns the table off", () => {
  assert.equal(routedModel("opus", "clips.description", "haiku"), "opus");
  assert.equal(routedModel("sonnet", "clips.suggest", "haiku"), "sonnet");
  assert.equal(routedModel(undefined, "clips.description", "haiku"), "haiku");
  assert.equal(routedModel(undefined, "clips.description", "haiku", false), undefined);
  assert.equal(routedModel(undefined, "clips.find", "haiku"), undefined);
  assert.equal(routedModel(undefined, undefined, "haiku"), undefined);
});

test("no routing touches fable", () => {
  assert.doesNotMatch(readFileSync(new URL("../src/lib/model-routing-pure.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, ""), /fable/i);
});

// 40 minutes of talk, one 4-word line every 5 s: ~16k+ chars, over the scout's FOCUS_ABOVE.
const talk: Word[] = Array.from({ length: 480 * 4 }, (_, i) => ({ start: Math.floor(i / 4) * 5 + (i % 4) * 0.8, end: Math.floor(i / 4) * 5 + (i % 4) * 0.8 + 0.6, text: `word${i}${i % 4 === 3 ? "." : ""}` }));

test("focusTranscript keeps every strong window whole, marks gaps, and stays under the cap", () => {
  const full = promptTranscript(talk, []);
  const wins = [{ start: 600, end: 640 }, { start: 1500, end: 1540 }, { start: 2100, end: 2140 }];
  const out = focusTranscript(talk, wins.map((w) => ({ start: w.start - 25, end: w.end + 10 })));
  assert.ok(out.length < full.length / 3 && out.length <= FOCUS_MAX, `${out.length} of ${full.length}`);
  for (const w of wins) for (const l of full.split("\n")) {
    const t = Number(/^\[([\d.]+)s\]/.exec(l)![1]);
    if (t >= w.start && t <= w.end) assert.ok(out.includes(l), `window line ${l} kept`); // recall: nothing inside a window is lost
  }
  assert.ok(out.split("\n").filter((l) => l === FOCUS_GAP).length >= 2);
  assert.ok(!out.includes("<"));
});

test("focusTranscript fills strongest regions first and skips a region that no longer fits", () => {
  const out = focusTranscript(talk, [{ start: 0, end: 120 }, { start: 1000, end: 2000 }, { start: 2300, end: 2330 }], 3000);
  assert.ok(out.startsWith("[0.0s]") && out.includes("[2300.0s]") && !out.includes("[1500.0s]") && out.length <= 3000);
  assert.equal(focusTranscript(talk, [{ start: 5000, end: 6000 }]), "");
});
