import { test } from "node:test";
import assert from "node:assert/strict";
import { funnel, outreachPrompt, validatePatch, validateProspect } from "../src/lib/business-pure.ts";

test("validateProspect needs a name and trims every field", () => {
  assert.equal(validateProspect({}), "Give the business a name");
  assert.equal(validateProspect({ name: "   " }), "Give the business a name");
  assert.deepEqual(validateProspect({ name: " Rullimeister ", kind: "bakery", contact: "info@x.ee", notes: 5 }),
    { name: "Rullimeister", kind: "bakery", contact: "info@x.ee", notes: "" });
  assert.equal((validateProspect({ name: "x".repeat(500) }) as { name: string }).name.length, 120);
});

test("validatePatch takes only valid fields that were sent", () => {
  assert.equal(validatePatch({}), "Nothing to change");
  assert.equal(validatePatch({ stage: "won" }), "Unknown stage");
  assert.equal(validatePatch({ fee: -1 }), "Fee must be 0–100000 € a month");
  assert.equal(validatePatch({ fee: "abc" }), "Fee must be 0–100000 € a month");
  assert.equal(validatePatch({ name: "" }), "Name can't be empty");
  assert.deepEqual(validatePatch({ stage: "paying", fee: "49.999" }), { stage: "paying", fee: 50 });
});

test("funnel counts stages and sums only paying fees", () => {
  const f = funnel([{ stage: "lead", fee: 0 }, { stage: "pilot", fee: 49 }, { stage: "paying", fee: 49 }, { stage: "paying", fee: 79.5 }]);
  assert.equal(f.total, 4);
  assert.equal(f.counts.paying, 2);
  assert.equal(f.counts.contacted, 0);
  assert.equal(f.monthly, 128.5);
});

test("outreach prompt names the language and keeps notes as data", () => {
  const p = outreachPrompt({ name: "Rullimeister", kind: "bakery", notes: "" }, "Estonian");
  assert.match(p, /^Write it in Estonian\./);
  assert.match(p, /notes: none/);
});
