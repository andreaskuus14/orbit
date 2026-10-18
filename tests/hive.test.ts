import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSONAS, agentPrompt, cleanProblem, judgePrompt, mergeIdeas, parseIdeas, parseJudge, sameIdea, voteTop } from "../src/lib/hive-pure.ts";

test("cleanProblem: trims, strips < > and control chars, enforces 3–300", () => {
  assert.equal(cleanProblem("  Roblox <b>game</b>\nidea  "), "Roblox b game /b idea");
  assert.equal(cleanProblem("hi"), "");
  assert.equal(cleanProblem("x".repeat(301)), "");
  assert.equal(cleanProblem(42), "");
});

test("agentPrompt fences the problem and names the persona", () => {
  const p = agentPrompt("next Short", PERSONAS[0]);
  assert.match(p, /<problem>\nnext Short\n<\/problem>/);
  assert.match(p, /Trend hunter/);
  assert.equal(new Set(PERSONAS.map((x) => x.id)).size, 6);
});

test("parseIdeas: prose/fences tolerated, max 3, junk dropped, [] for no JSON", () => {
  const r = parseIdeas('Sure!\n```json\n{"ideas":[{"title":"Pet Tower","pitch":"Climb"},{"title":"x"},{"title":"A","pitch":1},{"title":"B b","pitch":"p"},{"title":"C c"},{"title":"D d"}]}\n```');
  assert.deepEqual(r, [{ title: "Pet Tower", pitch: "Climb" }, { title: "B b", pitch: "p" }, { title: "C c", pitch: "" }]);
  assert.deepEqual(parseIdeas("nope"), []);
  assert.deepEqual(parseIdeas('{"ideas":"x"}'), []);
  assert.deepEqual(parseIdeas("{broken"), []);
});

test("sameIdea / mergeIdeas: near-duplicates become votes, a persona backs once", () => {
  assert.ok(sameIdea("Obby Pet Tower Climb", "Pet tower climb obby!"));
  assert.ok(!sameIdea("Pet Tower", "Cooking Race"));
  const m = mergeIdeas([
    { persona: "kid", ideas: [{ title: "Pet tower climb", pitch: "a" }, { title: "Pet Tower Climb!", pitch: "dup same persona" }] },
    { persona: "trend", ideas: [{ title: "Cooking race", pitch: "b" }, { title: "pet tower climb", pitch: "c" }] },
  ]);
  assert.deepEqual(m, [{ title: "Pet tower climb", pitch: "a", backers: ["kid", "trend"] }, { title: "Cooking race", pitch: "b", backers: ["trend"] }]);
});

const ideas = [{ title: "A a", pitch: "", backers: ["kid"] }, { title: "B b", pitch: "", backers: ["kid", "trend"] }, { title: "C c", pitch: "", backers: ["realist"] }, { title: "D d", pitch: "", backers: ["designer"] }];

test("voteTop: most backers first, ties by order", () => {
  assert.deepEqual(voteTop(ideas).map((p) => p.title), ["B b", "A a", "C c"]);
});

test("parseJudge: valid distinct picks, why kept; topped up by votes; junk → votes", () => {
  const r = parseJudge('{"top":[{"i":4,"why":"cheap"},{"i":4,"why":"dup"},{"i":9},{"i":"1","why":"fun"}]}', ideas);
  assert.deepEqual(r.map((p) => [p.title, p.why]), [["D d", "cheap"], ["A a", "fun"], ["B b", "2 minds pitched this independently"]]);
  assert.deepEqual(parseJudge("garbage", ideas).map((p) => p.title), ["B b", "A a", "C c"]);
  assert.deepEqual(parseJudge("{}", []), []);
});

test("judgePrompt numbers ideas with backers", () => {
  assert.match(judgePrompt("p", ideas), /2\. B b —  \(backed by 2: kid, trend\)/);
});
