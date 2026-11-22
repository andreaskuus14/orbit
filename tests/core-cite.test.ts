import { test } from "node:test";
import assert from "node:assert/strict";
import { citeAnswer, citeInfo, flagUncited, linkKey, parseMarker, stripNotes, traceCite } from "../src/lib/core-cite-pure.ts";

const M1 = "11111111-1111-4111-8111-111111111111", M2 = "22222222-2222-4222-8222-222222222222";
const cites = [{ id: M1, title: "pet sim economy", kind: "note" }, { id: M2, title: "Shop prices", kind: "decision" }];

test("memory, web and file citations get one number each, in reading order", () => {
  const info = citeInfo({ answer: "x https://a.com/p y", files: [{ name: "plan.pdf", vault: true }], web: false });
  const r = citeAnswer(`Eggs cost 50 coins [m:${M2}]. Prices rose ([source](https://a.com/p)). See [f:plan.pdf] and again [m:${M2}] [m:${M1}].`, cites, info);
  assert.equal(r.text, "Eggs cost 50 coins [[c1]]. Prices rose (source[[c2]]). See [[c3]] and again [[c1]] [[c4]].");
  assert.deepEqual(r.sources.map((s) => [s.n, s.kind, s.title]), [[1, "memory", "Shop prices"], [2, "web", "source"], [3, "file", "plan.pdf"], [4, "memory", "pet sim economy"]]);
  assert.equal(r.sources[2].href, "/api/vault?file=plan.pdf&raw=1");
  assert.equal(r.sources[1].href, "https://a.com/p");
});

test("unknown memory ids are dropped, code blocks stay as written, bare links become numbers", () => {
  const r = citeAnswer("See https://www.b.org/x/. [m:33333333-3333-4333-8333-333333333333]\n```\ncurl https://c.io/z\n```", []);
  assert.equal(r.text, "See [[c1]]. \n```\ncurl https://c.io/z\n```");
  assert.equal(r.sources[0].title, "b.org");
  assert.equal(linkKey("http://localhost:3000/x"), "", "ORBIT's own pages aren't sources");
});

test("fact-check verdicts and unopened links mark the number; the end notes go", () => {
  const answer = "Robux rose 10% in 2025 [Blog](https://blog.roblox.com/a). Players doubled <https://x.com/b>.";
  const info = citeInfo({ answer, claims: [{ key: 0, sources: ["blog.roblox.com/a"] }], verdicts: new Map([[0, "not_backed"]]), unseen: ["https://x.com/b"], web: true });
  assert.deepEqual(info.links, [{ u: "blog.roblox.com/a", v: "not_backed" }, { u: "x.com/b", v: "unopened" }]);
  const content = answer + "\n\n_Note: CORE didn't open this source this turn, so it is unchecked: <https://x.com/b>._\n\n_Fact check: this claim is not backed by the source it links: “Robux rose”._";
  const r = citeAnswer(content, [], info);
  assert.equal(r.text, "Robux rose 10% in 2025 Blog[[c1!]]. Players doubled [[c2?]].");
  assert.equal(r.sources[0].check, "not_backed");
  assert.equal(stripNotes("a\n\n_Faktikontroll: x._"), "a");
});

test("in a web turn, a sentence with figures and no source is marked; cited ones and plain prose are not", () => {
  assert.equal(flagUncited("The game has 2 million players. It is fun to play with friends. Revenue was $40k [[c1]]."),
    "The game has 2 million players [[nosrc]]. It is fun to play with friends. Revenue was $40k [[c1]].");
  assert.equal(flagUncited("# Top 10 games of 2025\n| a | 2025 |"), "# Top 10 games of 2025\n| a | 2025 |");
  const r = citeAnswer("About 300 people joined in March 2026.", [], { links: [], files: [], web: true });
  assert.match(r.text, /\[\[nosrc\]\]/);
  assert.doesNotMatch(citeAnswer("About 300 people joined in March 2026.", [], null).text, /nosrc/, "no web → no marks");
});

test("week citations already numbered by citeWeek keep their item", () => {
  const r = citeAnswer("You finished it [1].", [{ id: "w:goal:abc", title: "Ship the shop", kind: "week:goal" }]);
  assert.equal(r.text, "You finished it [[c1]].");
  assert.equal(r.sources[0].kind, "week");
});

test("markers parse; trace info reads back; older answers have none", () => {
  assert.deepEqual(parseMarker("[[c12!]]"), { n: 12, flag: "!" });
  assert.equal(parseMarker("[[nosrc]]"), "nosrc");
  assert.equal(parseMarker("[c1]"), null);
  const info = { links: [], files: [], web: true };
  assert.deepEqual(traceCite([{ step: "think" }, { step: "cite", cite: info }]), info);
  assert.equal(traceCite([{ step: "think" }]), null);
});
