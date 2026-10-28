import { test } from "node:test";
import assert from "node:assert/strict";
import { WORK_TABS, workTabOf, workTabName, parseWorkTab } from "../src/lib/work-vocab-pure.ts";
import { parseNavCommand, navLabel } from "../src/lib/nav-pure.ts";

test("every internal record has exactly one user-facing name", () => {
  const all = WORK_TABS.flatMap((w) => w.records);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(["task", "mission", "chain", "team"].map(workTabOf), ["work", "work", "work", "work"]);
  assert.deepEqual(["rule", "automation", "schedule"].map(workTabOf), ["routines", "routines", "routines"]);
  assert.deepEqual(["skill", "Recipe"].map(workTabOf), ["workflows", "workflows"]);
  assert.equal(workTabOf("goal"), "goals");
  assert.equal(workTabOf("unknown"), "work");
  assert.equal(workTabName("workflows", "et"), "Salvestatud töövood");
  assert.equal(parseWorkTab("nope"), "work");
});

test("CORE words open the Work sheet on the right tab (EN/ET)", () => {
  const cases: [string, string][] = [["open routines", "routines"], ["show my goals", "goals"], ["saved workflows", "workflows"],
    ["work", "work"], ["open my work", "work"], ["eesmärgid", "goals"], ["ava rutiinid", "routines"], ["töövood", "workflows"]];
  for (const [said, tab] of cases) assert.deepEqual(parseNavCommand(said), { panel: null, continueWork: true, workTab: tab }, said);
  assert.equal(navLabel({ panel: null, continueWork: true, workTab: "routines" }), "Routines");
  assert.deepEqual(parseNavCommand("bring up my tasks"), { panel: "operations" }); // OPERATIONS keeps its words
});
