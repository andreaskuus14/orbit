import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProposalJson, cleanProposals, normTitle, isMissingTable } from "../src/lib/proactive-pure.ts";

const AGENTS = ["nova", "atlas", "pulse"];
const p = (o: Record<string, unknown> = {}) => ({
  title: "Research the EU AI Act", why: "Three headlines about it today", agent: "atlas",
  prompt: "Research the latest EU AI Act developments and summarise.", kind: "research", ...o,
});

test("extractProposalJson handles fences, prose, object and array forms", () => {
  assert.equal(extractProposalJson('Sure!\n```json\n{"proposals":[{"title":"x"}]}\n```').length, 1);
  assert.equal(extractProposalJson('[{"title":"a"},{"title":"b"}]').length, 2);
  assert.deepEqual(extractProposalJson("no json here"), []);
  assert.deepEqual(extractProposalJson("{broken"), []);
  assert.deepEqual(extractProposalJson('{"other":1}'), []);
});

test("cleanProposals validates fields and agents, defaults kind", () => {
  const out = cleanProposals([p(), p({ title: "Bad agent", agent: "hacker" }), p({ title: "x" }), p({ title: "Short prompt", prompt: "do it" }), "junk", null,
    p({ title: "Odd kind", kind: "weird" })], { agents: AGENTS, existingTitles: [], max: 3 });
  assert.deepEqual(out.map((o) => o.title), ["Research the EU AI Act", "Odd kind"]);
  assert.equal(out[1].kind, "followup");
});

test("cleanProposals dedupes against existing titles and within the batch, respects max", () => {
  const raw = [p({ title: "research: the EU AI-Act" }), p({ title: "Watch oil prices", agent: "pulse" }), p({ title: "WATCH oil prices!" }),
    p({ title: "Plan the week", agent: "nova" }), p({ title: "Fourth thing", agent: "nova" })];
  const out = cleanProposals(raw, { agents: AGENTS, existingTitles: ["Research the EU AI Act"], max: 2 });
  assert.deepEqual(out.map((o) => o.title), ["Watch oil prices", "Plan the week"]);
  assert.deepEqual(cleanProposals(raw, { agents: AGENTS, existingTitles: [], max: 0 }), []);
});

test("normTitle and isMissingTable", () => {
  assert.equal(normTitle("  ⚙ Research: EU AI-Act! "), "research eu ai act");
  assert.ok(isMissingTable({ code: "42P01" }));
  assert.ok(isMissingTable({ message: "Could not find the table 'public.proposals' in the schema cache" }));
  assert.ok(!isMissingTable({ code: "23514", message: "check violation" }));
  assert.ok(!isMissingTable(null));
});
