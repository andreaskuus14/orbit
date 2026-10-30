import { test } from "node:test";
import assert from "node:assert/strict";
import { addVersion, cleanCard, currentVersion, logRun, pickVersion, promote, recordEval, rollback, runsByVersion, setCard, splitVersion, type Skill } from "../src/lib/skills-pure.ts";

const d = (instruction: string) => ({ name: "weekly-check", instruction, tools: ["web_search"], example: "x" });
const base: Skill = { id: "s", current: 1, versions: [{ ...d("first version text"), v: 1, at: "2026-10-01", note: "kept" }], created_at: "2026-10-01" };

test("AGT04 an edit is a candidate; promote needs a card and a passing eval", () => {
  const s = addVersion(base, d("second version text"), "edited", "2026-10-02", true);
  assert.equal(s.current, 1);
  assert.equal(currentVersion(s).instruction, "first version text");
  assert.equal(promote(s, 2), "Fill in the version card first");
  const card = cleanCard({ owner: "Andreas", inputs: "a niche name", examples: "roblox tycoons\nhorror shorts", limits: "no posting" });
  assert.ok(typeof card !== "string");
  assert.deepEqual(card.examples, ["roblox tycoons", "horror shorts"]);
  const c = setCard(s, 2, card) as Skill;
  assert.equal(promote(c, 2), "Record a passing eval first");
  const failed = recordEval(c, 2, false, "missed sources", "2026-10-03") as Skill;
  assert.equal(promote(failed, 2), "Record a passing eval first");
  const ok = promote(recordEval(c, 2, true, "good", "2026-10-03") as Skill, 2) as Skill;
  assert.equal(ok.current, 2);
  assert.equal(typeof cleanCard({ inputs: "x" }), "string");
  assert.equal(setCard(base, 9, card), "No such version");
});

test("AGT04 rollback still works; runs keep their version; name v2 picks a version", () => {
  const s = addVersion(base, d("second version text"), "edited", "2026-10-02"); // unstaged (rollback path) becomes current
  assert.equal(s.current, 2);
  const r = rollback(s, 1, "2026-10-03") as Skill;
  assert.equal(currentVersion(r).instruction, "first version text");
  const runs = logRun(logRun(logRun(r, 1, "a"), 3, "b"), 3, "c");
  assert.deepEqual(runsByVersion(runs), { 1: 1, 3: 2 });
  assert.deepEqual(splitVersion("weekly-check v2"), { name: "weekly-check", v: 2 });
  assert.deepEqual(splitVersion("weekly-check"), { name: "weekly-check" });
  assert.equal(pickVersion(r, 7), "No version v7");
  assert.equal((pickVersion(r, 1) as { v: number }).v, 1);
});

test("AGT04 staging many candidates never drops the current version", () => {
  let s = base;
  for (let i = 0; i < 25; i++) s = addVersion(s, d(`candidate number ${i}`), "edited", "2026-10-02", true);
  assert.equal(s.current, 1);
  assert.ok(s.versions.some((v) => v.v === 1));
});
