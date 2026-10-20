import { test } from "node:test";
import assert from "node:assert/strict";
import { FIND_MAX, emailIn, findPrompt, funnel, outreachPrompt, parseFinds, sendSubject, validatePatch, validateProspect } from "../src/lib/business-pure.ts";

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
  assert.equal(validatePatch({ notes: null }), "notes must be text");
  assert.equal(validatePatch({ fee: 100001 }), "Fee must be 0–100000 € a month");
  assert.deepEqual(validatePatch({ notes: "called\u0007 owner" }), { notes: "called owner" });
  assert.deepEqual(validatePatch({ stage: "paying", fee: "49.999" }), { stage: "paying", fee: 50 });
  assert.deepEqual(validatePatch({ fee: "12,50" }), { fee: 12.5 });
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

test("parseFinds keeps only named, cleaned, unique entries from the JSON array", () => {
  const answer = 'Here you go:\n```json\n[{"name":"Koogipood","kind":"bakery","contact":"koogipood.ee","why":"takes cake orders"},{"name":"koogipood","kind":"dup"},{"kind":"no name"},5,{"name":"Salon\\u0007 X","contact":42}]\n```';
  assert.deepEqual(parseFinds(answer), [
    { name: "Koogipood", kind: "bakery", contact: "koogipood.ee", why: "takes cake orders" },
    { name: "Salon X", kind: "", contact: "", why: "" },
  ]);
  assert.deepEqual(parseFinds('Results [from the web]: [{"name":"A"}]\nSources: [1] a.ee'), [{ name: "A", kind: "", contact: "", why: "" }]);
  assert.deepEqual(parseFinds("no results"), []);
  assert.deepEqual(parseFinds("[not json]"), []);
  assert.equal(parseFinds(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ name: `B${i}` })))).length, FIND_MAX);
});

test("findPrompt caps the owner's query", () => {
  assert.equal(findPrompt("cake shops Tallinn"), "Find businesses for: cake shops Tallinn");
  assert.equal(findPrompt("x".repeat(500)).length, "Find businesses for: ".length + 120);
});

test("approve & send: one clear email address only, subject in the draft's language", () => {
  assert.equal(emailIn("info@pats.ee"), "info@pats.ee");
  assert.equal(emailIn("Tel 5860 0648, tellimus@pats.ee"), "tellimus@pats.ee");
  assert.equal(emailIn("+372 5860 0648"), null);
  assert.equal(emailIn("a@x.ee, b@x.ee"), null);
  assert.equal(sendSubject("Päts sahver", "Tere! Märkasin, et teete tellimustorte."), "Väike idee Päts sahver jaoks");
  assert.equal(sendSubject("Pats", "Здравствуйте!"), "Небольшая идея для Pats");
  assert.equal(sendSubject("Pats\r\nBcc: x@y.z", "Hi there"), "A quick idea for Pats Bcc: x@y.z");
});
