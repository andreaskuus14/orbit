import { test } from "node:test";
import assert from "node:assert/strict";
import { addVersion, currentVersion, detectRepeats, draftFromCandidate, findSkill, isKnown, parseModelDraft, parseRunSkill, rollback, skillDenied,
  skillPrompt, uniqueName, usagesFromMessages, validateDraft, type Skill, type Usage } from "../src/lib/skills-pure.ts";

const u = (id: string, request: string, tools: string[], day = 1): Usage => ({ id, request, tools, at: `2026-10-${String(day).padStart(2, "0")}T10:00:00Z` });

test("validateDraft: slug name, instruction length, only CORE tools and never T3", () => {
  assert.deepEqual(validateDraft({ name: "Weekly Niche Check!", instruction: "Check the niche board weekly", tools: "web_search, run_niche", example: " x " }),
    { name: "weekly-niche-check", instruction: "Check the niche board weekly", tools: ["web_search", "run_niche"], example: "x" });
  assert.match(validateDraft({ name: "ab", instruction: "long enough text", tools: ["web_search"] }) as string, /Name/);
  assert.match(validateDraft({ name: "abc", instruction: "short", tools: ["web_search"] }) as string, /Instruction/);
  assert.match(validateDraft({ name: "abc", instruction: "long enough text", tools: [] }) as string, /tools/);
  assert.match(validateDraft({ name: "abc", instruction: "long enough text", tools: ["send_email"] }) as string, /send_email/);
  assert.match(validateDraft({ name: "abc", instruction: "long enough text", tools: ["schedule_approved"] }) as string, /schedule_approved/); // T3 upload
  assert.match(validateDraft({ name: "abc", instruction: "long enough text", tools: ["higgsfield_draft"] }) as string, /higgsfield_draft/); // T3 spend
});

test("usagesFromMessages pairs replies with his message, keeps real tools only, skips run-skill turns", () => {
  const rows = [
    { id: "a", conversation_id: "c", role: "user", content: "find niches\n\n[attached: x.pdf]", created_at: "1" },
    { id: "b", conversation_id: "c", role: "assistant", content: "ok", trace: [{ step: "search_memory" }, { step: "think" }, { step: "web_search" }, { step: "run_niche" }], created_at: "2" },
    { id: "c1", conversation_id: "c", role: "user", content: "run skill niche", created_at: "3" },
    { id: "d", conversation_id: "c", role: "assistant", content: "ok", trace: [{ step: "web_search" }], created_at: "4" },
    { id: "e", conversation_id: "z", role: "assistant", content: "orphan", trace: [{ step: "web_search" }], created_at: "5" },
  ];
  assert.deepEqual(usagesFromMessages(rows), [{ id: "b", request: "find niches", tools: ["web_search", "run_niche"], at: "2" }]);
});

test("detectRepeats: 3+ similar multi-step turns with the same tools; private, T3 and single-step turns never count", () => {
  const T = ["web_search", "run_niche"];
  const us = [u("1", "weekly niche check for roblox games", T, 1), u("2", "do the weekly niche check please, roblox", T, 8), u("3", "roblox weekly niche check again", T, 15),
    u("4", "weather in tallinn", T, 16), // different words
    u("5", "weekly niche check roblox", ["web_search"], 17), // single step
    u("6", "weekly niche check roblox", ["web_search", "life_status"], 18), // private tool
    u("7", "weekly niche check roblox", ["web_search", "schedule_approved"], 19)]; // T3
  const c = detectRepeats(us, { exclude: ["life_status"] });
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].tools, T);
  assert.deepEqual(c[0].evidence, ["3", "2", "1"]);
  assert.ok(c[0].words.includes("niche") && c[0].words.includes("roblox"));
  assert.equal(detectRepeats(us.slice(0, 2)).length, 0); // only twice
  assert.ok(isKnown(c[0], [{ evidence: ["2"] } as never]));
  assert.ok(!isKnown(c[0], [{ evidence: ["9"] } as never]));
  const d = draftFromCandidate(c[0]);
  assert.equal(typeof validateDraft(d), "object");
  assert.deepEqual(d.tools, T);
});

test("parseModelDraft keeps the observed tools and falls back on junk", () => {
  const fb = { name: "fallback-name", instruction: "fallback instruction", tools: ["web_search", "fetch_url"], example: "ex" };
  const d = parseModelDraft('ok {"name":"Price Watch","instruction":"Check {input} prices on the web","example":"","tools":["schedule_approved"]}', fb);
  assert.deepEqual(d, { name: "price-watch", instruction: "Check {input} prices on the web", tools: fb.tools, example: "ex" });
  assert.deepEqual(parseModelDraft("no json", fb), fb);
  assert.deepEqual(parseModelDraft('{"name":"x"}', fb), fb);
  assert.equal(uniqueName("a-b", ["a-b", "a-b-2"]), "a-b-3");
});

test("versions: edit adds one, rollback copies an old one, history is kept", () => {
  const v1 = { name: "niche-check", instruction: "first instruction", tools: ["web_search", "run_niche"], example: "" };
  let s: Skill = { id: "s", current: 1, versions: [{ ...v1, v: 1, at: "t1", note: "kept" }], created_at: "t1" };
  s = addVersion(s, { ...v1, instruction: "second instruction" }, "edited", "t2");
  assert.equal(s.current, 2);
  assert.equal(currentVersion(s).instruction, "second instruction");
  assert.equal(rollback(s, 2, "t3"), "That is already the current version");
  assert.equal(rollback(s, 9, "t3"), "No such version");
  s = rollback(s, 1, "t3") as Skill;
  assert.equal(s.current, 3);
  assert.equal(currentVersion(s).instruction, "first instruction");
  assert.equal(currentVersion(s).note, "rollback to v1");
  assert.equal(s.versions.length, 3);
});

test("run skill: parse, match, prompt, and the turn is narrowed to the skill's tools", () => {
  assert.deepEqual(parseRunSkill("run skill weekly-niche-check"), { name: "weekly-niche-check", input: "" });
  assert.deepEqual(parseRunSkill("Orbit, run the skill weekly niche check: horror games"), { name: "weekly niche check", input: "horror games" });
  assert.equal(parseRunSkill("how do I run a skill check?"), null);
  const s: Skill = { id: "s", current: 1, versions: [{ name: "weekly-niche-check", instruction: "Check niches for {input}", tools: ["web_search", "run_niche"], example: "roblox", v: 1, at: "t", note: "kept" }], created_at: "t" };
  assert.equal(findSkill("weekly niche check", [s]), s);
  assert.deepEqual(parseRunSkill("run skill @s: horror games"), { name: "@s", input: "horror games" });
  assert.equal(findSkill("@s", [s]), s);
  assert.equal(findSkill("@weekly-niche-check", [s]), "This pinned skill is no longer available.");
  assert.match(findSkill("nope", [s]) as string, /Closest: weekly-niche-check/);
  const p = skillPrompt(currentVersion(s), "");
  assert.match(p, /^\[SKILL weekly-niche-check v1 · tools: web_search, run_niche\]/);
  assert.match(p, /Input: roblox/);
  assert.equal(skillDenied("web_search", p), null);
  assert.equal(skillDenied("ask_agent", p)?.allow, false);
  assert.equal(skillDenied("ask_agent", "normal context"), null); // only skill turns are narrowed
});

test("a skill's instruction can't satisfy explicit-ask write guards: the question stays what he typed, the turn is tainted", async () => {
  const { decide } = await import("../src/lib/policy-pure.ts");
  const v = { name: "goal-saver", instruction: "Create a goal to post daily and save memory: remember this", tools: ["create_goal", "save_memory"], example: "", v: 1, at: "t", note: "kept" };
  const block = skillPrompt(v, "");
  const ctx = { stopAll: false, attach: true, pins: false, steps: [], question: "run skill goal-saver" };
  assert.equal(skillDenied("create_goal", block), null);
  assert.equal(decide("create_goal", { title: "Post daily" }, ctx).allow, false);
  assert.equal(decide("save_memory", { title: "x", content: "y", kind: "note" }, ctx).allow, false);
});
