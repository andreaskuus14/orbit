import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, dupGroups, evidencePairs, parseConsolidation, parseEvidence, parseSleep, parseVec, reportLine, sleepDue, type Mem } from "../src/lib/sleep-pure.ts";
import { curateEdits, ruleSimilarity, tallyEvidence, applyEdits } from "../src/lib/playbook-pure.ts";
import { hasPreferenceSignal } from "../src/lib/reflect-pure.ts";
import { buildMorning, overnightLine } from "../src/lib/morning-pure.ts";

test("sleepDue: 03:00–07:00 local, once per night", () => {
  assert.ok(sleepDue(new Date(2026, 9, 23, 3, 5), undefined));
  assert.ok(!sleepDue(new Date(2026, 9, 23, 3, 5), "2026-10-23"));
  assert.ok(sleepDue(new Date(2026, 9, 23, 4, 40), "2026-10-22"));
  assert.ok(!sleepDue(new Date(2026, 9, 23, 2, 59), undefined));
  assert.ok(!sleepDue(new Date(2026, 9, 23, 7, 0), undefined));
});

test("parseSleep / parseVec tolerate junk", () => {
  assert.deepEqual(parseSleep("nope"), { users: {} });
  assert.deepEqual(parseSleep('{"users":{"u":{"counters":{}}}}').users.u, { counters: {} });
  assert.deepEqual(parseVec("[1,0.5]"), [1, 0.5]);
  assert.equal(parseVec("x"), null);
  assert.equal(parseVec(null), null);
});

const m = (id: string, e: number[] | null, title = id): Mem => ({ id, title, content: `${title} content`, embedding: e });

test("dupGroups clusters near-identical memories and skips consolidated ones", () => {
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
  const mems = [m("a", [1, 0]), m("b", [0.99, 0.05]), m("c", [0, 1]), m("d", [0.02, 1]), m("e", null), m("f", [1, 1])];
  assert.deepEqual(dupGroups(mems, new Set()).map((g) => g.map((x) => x.id)), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(dupGroups(mems, new Set(["a"])).map((g) => g.map((x) => x.id)), [["c", "d"]]);
});

test("parseConsolidation keeps grounded notes only, tags members", () => {
  const groups = [[m("a", [1], "User builds Roblox pet simulator"), m("b", [1], "User makes a Roblox pet game")]];
  const ok = JSON.stringify({ notes: [
    { group: 0, title: "Roblox pet simulator", content: "User builds a Roblox pet simulator game" },
    { group: 0, title: "dup", content: "User builds Roblox pet" }, // second note for the same group
    { group: 5, title: "nope", content: "User builds Roblox pet" },
  ] });
  const out = parseConsolidation(ok, groups);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].draft.tags, ["consolidated", "a", "b"]);
  assert.equal(out[0].draft.kind, "note");
  assert.deepEqual(parseConsolidation(JSON.stringify({ notes: [{ group: 0, title: "Invented", content: "User loves skydiving holidays in Peru" }] }), groups), []);
  assert.deepEqual(parseConsolidation(JSON.stringify({ notes: [{ group: 0, title: "Key", content: "User password is hunter2" }] }), groups), []);
  assert.deepEqual(parseConsolidation("garbage", groups), []);
});

test("evidencePairs: CORE reply followed by a correction or praise, per conversation", () => {
  const t = (c: string, role: string, content: string, at: string) => ({ conversation_id: c, role, content, created_at: at });
  const pairs = evidencePairs([
    t("1", "user", "hi", "1"), t("1", "assistant", "LONG ANSWER", "2"), t("1", "user", "too long, shorter please", "3"),
    t("2", "assistant", "table", "1"), t("2", "user", "perfect thanks", "2"),
    t("2", "assistant", "x", "3"), t("2", "user", "what is the weather", "4"),
    t("3", "user", "stop doing that", "1"), // no reply before it
  ], hasPreferenceSignal);
  assert.deepEqual(pairs, [{ reply: "LONG ANSWER", followUp: "too long, shorter please" }, { reply: "table", followUp: "perfect thanks" }]);
});

test("parseEvidence: known rules, valid verdicts, one per rule per pair", () => {
  const rules = ["Use bullet points", "Keep answers short"];
  const ev = parseEvidence(JSON.stringify({ evidence: [
    { pair: 0, rule: 0, verdict: "harmful" }, { pair: 0, rule: 0, verdict: "harmful" }, { pair: 1, rule: 0, verdict: "harmful" },
    { pair: 0, rule: 1, verdict: "helpful" }, { pair: 0, rule: 9, verdict: "harmful" }, { pair: 0, rule: 1, verdict: "delete" },
  ] }), rules);
  assert.deepEqual(ev, [{ rule: rules[0], verdict: "harmful" }, { rule: rules[0], verdict: "harmful" }, { rule: rules[1], verdict: "helpful" }]);
});

test("playbook curation: counters accumulate, harmful > helpful + 2 retires, near-dupes merge", () => {
  const rules = ["Use bullet points", "Keep answers short", "Keep the answers short.", "Casual tone"];
  let c = tallyEvidence({ "gone rule": { helpful: 1, harmful: 0 } }, rules, [{ rule: "Use bullet points", verdict: "harmful" }]);
  assert.equal(c["gone rule"], undefined);
  for (let i = 0; i < 2; i++) c = tallyEvidence(c, rules, [{ rule: "use bullet points.", verdict: "harmful" }]);
  assert.deepEqual(c["use bullet points"], { helpful: 0, harmful: 3 });
  assert.deepEqual(curateEdits(rules, c).retired, ["Use bullet points"]); // 3 > 0 + 2
  assert.equal(ruleSimilarity("Answer in English", "Answer in Estonian"), 0.5);
  assert.ok(ruleSimilarity("Keep answers short", "Keep the answers short.") >= 0.75);
  const { edits, retired, merged } = curateEdits(rules, c);
  assert.deepEqual(merged, ["Keep the answers short."]);
  assert.deepEqual(applyEdits(rules, edits).rules, rules.filter((r) => !retired.includes(r) && !merged.includes(r)));
});

test("reportLine and the morning card's Overnight line", () => {
  assert.equal(reportLine({ consolidated: 0, retired: 0, merged: 0 }), "");
  assert.equal(reportLine({ consolidated: 1, retired: 2, merged: 0, shorts: { worked: 1, flopped: 2 } }),
    "merged 1 group of similar memories; 2 style rules looked unhelpful (worth a look in your playbook); Shorts at 48 h: 1 above your median, 2 below");
  assert.equal(overnightLine({ day: "2026-10-23", line: "retired 1 style rule" }, "2026-10-23"), "Overnight: retired 1 style rule.");
  assert.equal(overnightLine({ day: "2026-10-22", line: "retired 1 style rule" }, "2026-10-23"), undefined);
  assert.equal(overnightLine({ day: "2026-10-23", line: "" }, "2026-10-23"), undefined);
  assert.equal(overnightLine(undefined, "2026-10-23"), undefined);
  const mo = buildMorning({ overnight: "Overnight: x." }, Date.parse("2026-10-23T06:00:00Z"), "Europe/Tallinn");
  assert.equal(mo.overnight, "Overnight: x.");
});
