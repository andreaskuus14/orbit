import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_AGENTS, BUILTIN_ONLY_TOOLS, fixPrompt, selfCheck } from "../src/lib/agent-defs-pure.ts";
import { readiness, scoreAnswer, scoreDefs, scoreRuns, validateSuite } from "../src/lib/agent-eval-pure.ts";
import { AGENT_SUITE } from "../evals/agent-suite.ts";
import { BASELINE_AGENTS } from "../evals/agent-baseline.ts";
import { BUILTIN_AGENT_NAMES } from "../src/lib/agent-command-pure.ts";

const def = (slug: string) => BUILTIN_AGENTS.find((a) => a.slug === slug)!;
const ATLAS_SEEN = "TITLE: Godot license\nURL: https://godotengine.org/license/\nMIT license.";
const ATLAS_OK = "## Summary\nGodot is free.\n## Key findings\n- MIT license ([Godot license](https://godotengine.org/license/))\n## Uncertain\nNone.\n## Sources\n- [Godot license](https://godotengine.org/license/)";

test("roster: same agents as the client mirror; every one has done, contract, self-check, ET and send rules and a tier", () => {
  assert.deepEqual(BUILTIN_AGENTS.map((a) => a.slug), BUILTIN_AGENT_NAMES.map((a) => a.slug));
  for (const a of BUILTIN_AGENTS) {
    for (const re of [/DONE WHEN:/, /OUTPUT:/, /SELF-CHECK/, /Estonian/, /never send/i]) assert.match(a.instructions, re, `${a.slug} ${re}`);
    assert.ok(a.tier && a.builtin, a.slug);
  }
  assert.equal(def("atlas").tier, "smart");
  assert.equal(def("vector").tier, "fast");
  assert.ok(def("atlas").tools.includes("web_search") && !def("atlas").tools.includes("search_articles"));
  // private files never sit next to an outbound tool
  for (const a of BUILTIN_AGENTS.filter((x) => x.tools.some((t) => BUILTIN_ONLY_TOOLS.includes(t)))) {
    assert.ok(!a.tools.some((t) => ["fetch_url", "web_search", "read_news", "news_search"].includes(t)), a.slug);
  }
});

test("selfCheck: a correct research report passes; fabricated links, missing sections and no sources fail", () => {
  const atlas = def("atlas").contract;
  assert.deepEqual(selfCheck(atlas, ATLAS_OK, { request: "Compare engines", seen: ATLAS_SEEN }), []);
  const fake = ATLAS_OK.replace("https://godotengine.org/license/))", "https://godotengine.org/pricing))");
  assert.match(selfCheck(atlas, fake, { request: "r", seen: ATLAS_SEEN }).join(), /never returned by a tool: https:\/\/godotengine\.org\/pricing/);
  assert.match(selfCheck(atlas, "Godot is free.", { request: "r", seen: ATLAS_SEEN }).join(), /missing section\(s\): Summary, Key findings, Uncertain, Sources.*no source links/);
  // the same URL with tracking params / www still counts as the page that was read
  assert.deepEqual(selfCheck(atlas, ATLAS_OK.replaceAll("https://godotengine.org/license/", "https://www.godotengine.org/license?utm_source=x"), { request: "r", seen: ATLAS_SEEN }), []);
  assert.deepEqual(selfCheck(undefined, "", { request: "r", seen: "" }), ["the answer is empty"]);
});

test("selfCheck: Estonian requests need Estonian answers and headings; the quiet one-liner counts", () => {
  const atlas = def("atlas").contract;
  const et = ATLAS_OK.replace("Summary", "Kokkuvõte").replace("Key findings", "Peamised leiud").replace("Uncertain", "Ebakindel").replace("Sources", "Allikad").replace("Godot is free.", "Godot on tasuta ja avatud lähtekoodiga.");
  assert.deepEqual(selfCheck(atlas, et, { request: "Võrdle mootoreid, palun", seen: ATLAS_SEEN }), []);
  assert.match(selfCheck(atlas, ATLAS_OK, { request: "Võrdle mootoreid, palun", seen: ATLAS_SEEN }).join(), /Estonian/);
  assert.deepEqual(selfCheck(def("sentinel").contract, "Olulisi muutusi pole.", { request: "Kas Comet kohta on midagi uut?", seen: "" }), []);
  assert.deepEqual(selfCheck(def("sentinel").contract, "No important changes since your last note.", { request: "Anything new?", seen: "" }), []);
});

test("selfCheck: files parse, numbers come from data, memory cites are real, nothing claims to be sent", () => {
  assert.match(selfCheck(def("forge").contract, "```json\n{\"a\": 1,}\n```", { request: "r", seen: "" }).join(), /fenced json: JSON does not parse/);
  assert.match(selfCheck(def("forge").contract, "```csv\na,b\n1\n```", { request: "r", seen: "" }).join(), /column counts/);
  assert.deepEqual(selfCheck(def("forge").contract, "```json\n[{\"step\": \"Trailer\"}]\n```", { request: "r", seen: "" }), []);
  assert.match(selfCheck(def("forge").contract, "Plan\n- TODO: fill in", { request: "r", seen: "" }).join(), /placeholder/);
  const stats = "Tasks by status: done: 17, failed: 3";
  assert.deepEqual(selfCheck(def("vector").contract, "| status | n |\n|---|---|\n| done | 17 |\n| failed | 3 |\n\n15% failed.", { request: "r", seen: stats }), []);
  assert.match(selfCheck(def("vector").contract, "| status | n |\n|---|---|\n| done | 21 |", { request: "r", seen: stats }).join(), /not in the tool data: 21/);
  assert.match(selfCheck(def("vector").contract, "17 done.", { request: "r", seen: stats }).join(), /no Markdown table/);
  assert.match(selfCheck(undefined, "Nebula launches Monday [m:zz9].", { request: "r", seen: "[m:a1] Nebula" }).join(), /\[m:zz9\]/);
  assert.match(selfCheck(undefined, "Done: I sent the email to your team.", { request: "r", seen: "" }).join(), /sent, published or paid/);
  assert.match(selfCheck(def("flow").contract, "Every Friday at 16:00 Echo summarises your notes.", { request: "r", seen: "" }).join(), /approval/);
  assert.match(fixPrompt("draft", ["a", "b"]), /SELF-CHECK FAILED: a; b/);
});

test("eval suite: 5-8 tasks per agent, readiness never drops, recorded answers are checked and missing ones stay pending", () => {
  validateSuite(AGENT_SUITE, BUILTIN_AGENTS.map((a) => a.slug));
  const before = scoreDefs(BASELINE_AGENTS, AGENT_SUITE), after = scoreDefs(BUILTIN_AGENTS, AGENT_SUITE);
  for (const a of after) assert.ok(a.pct >= before.find((b) => b.agent === a.agent)!.pct, a.agent);
  assert.ok(readiness(undefined, AGENT_SUITE[0]).every((r) => !r.ok));
  const t = AGENT_SUITE.find((x) => x.id === "qa-verify")!;
  const good = "## Verdicts\n- MIT, no royalties: Verified ([Godot license](https://godotengine.org/license/))\n## Overall\nPass";
  assert.deepEqual(scoreAnswer(t, def("qa"), good), { ok: true, fails: [] });
  const r = scoreRuns(BUILTIN_AGENTS, AGENT_SUITE, [{ id: "qa-verify", answer: good }, { id: "qa-contradicted", answer: good }]);
  assert.deepEqual(r.runs.map((x) => [x.id, x.ok]), [["qa-verify", true], ["qa-contradicted", false]]);
  assert.equal(r.pending.length, AGENT_SUITE.length - 2);
  assert.throws(() => scoreRuns(BUILTIN_AGENTS, AGENT_SUITE, [{ id: "x" }]), /string id and answer/);
});
