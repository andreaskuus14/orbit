import { test } from "node:test";
import assert from "node:assert/strict";
import { answerLevel, autoLevel, deepAllowed, levelDetail, parseChoice, parseLevelDetail, pickLevel, tierOfLevel } from "../src/lib/think-level-pure.ts";

const roomy = { pct: 10, warnPct: 80, limited: false };

test("auto: simple facts go quick, normal asks normal, code and planning go deep", () => {
  for (const q of ["hi", "thanks!", "what's 2+2"]) assert.equal(autoLevel(q).level, "quick", q);
  for (const q of ["what did I tell you about my pet sim economy?", "search the latest Roblox news"]) assert.equal(autoLevel(q).level, "normal", q);
  assert.deepEqual(autoLevel("fix this bug in my luau script: the shop never saves"), { level: "deep", why: "code" });
  assert.deepEqual(autoLevel("```lua\nprint(1)\n```\nwhy does this crash"), { level: "deep", why: "code" });
  assert.deepEqual(autoLevel("make a plan for launching my YouTube channel this month"), { level: "deep", why: "planning" });
  assert.deepEqual(autoLevel("deep: is now a good time"), { level: "deep", why: "asked" });
  assert.notEqual(autoLevel("plan?").level, "deep", "a bare word is not a planning ask");
});

test("override wins; files never go quick; phone calls never go deep", () => {
  assert.equal(pickLevel({ question: "hi", choice: "deep", quota: roomy }).level, "deep");
  assert.equal(pickLevel({ question: "write a function that sorts pets", choice: "quick", quota: roomy }).level, "quick");
  assert.deepEqual(pickLevel({ question: "hi", choice: "quick", attach: true }), { level: "normal", why: "files", choice: "quick" });
  assert.deepEqual(pickLevel({ question: "make a plan for my whole week ahead", call: true, quota: roomy }), { level: "normal", why: "call", choice: "auto" });
});

test("usage pacer: auto deep only under the warning line; a chosen deep until full or limited", () => {
  const q = "make a plan for launching my YouTube channel this month";
  assert.equal(pickLevel({ question: q, quota: roomy }).level, "deep");
  assert.deepEqual(pickLevel({ question: q, quota: { pct: 85, warnPct: 80, limited: false } }), { level: "normal", why: "usage", choice: "auto", capped: true });
  assert.equal(pickLevel({ question: q, choice: "deep", quota: { pct: 85, warnPct: 80, limited: false } }).level, "deep");
  assert.equal(pickLevel({ question: q, choice: "deep", quota: { pct: 100, warnPct: 80, limited: false } }).capped, true);
  assert.equal(pickLevel({ question: q, choice: "deep", quota: { pct: 5, warnPct: 80, limited: true } }).level, "normal");
  assert.equal(deepAllowed(null, false), true, "no meter → allowed");
});

test("safety asks always run deep, even when quick was chosen or usage is high", () => {
  assert.deepEqual(pickLevel({ question: "send it", choice: "quick", risky: true, quota: { pct: 99, warnPct: 80, limited: false } }), { level: "deep", why: "safety", choice: "quick" });
});

test("tiers, parse and the persisted trace line", () => {
  assert.equal(tierOfLevel("quick"), "fast"); assert.equal(tierOfLevel("normal"), "smart"); assert.equal(tierOfLevel("deep"), "deep");
  assert.equal(parseChoice("deep"), "deep"); assert.equal(parseChoice("fable"), "auto"); assert.equal(parseChoice(undefined), "auto");
  const p = pickLevel({ question: "make a plan for launching my channel this month", quota: { pct: 90, warnPct: 80, limited: false } });
  assert.deepEqual(parseLevelDetail(levelDetail(p)), { level: "normal", why: "usage", capped: true });
  const trace = [{ step: "level", detail: "quick · auto · simple" }];
  assert.equal(answerLevel(trace)?.level, "quick");
  assert.equal(answerLevel(trace, "smart")?.level, "normal", "a quick turn redone on the main model says normal");
  assert.equal(answerLevel([], "deep")?.level, "deep");
  assert.equal(answerLevel(undefined), null);
});
