import { test } from "node:test";
import assert from "node:assert/strict";
import { addEvent, claimProblem, contactKey, deliveryPlan, duplicateOf, newCrm, touch, type CrmEvent } from "../src/lib/prospect-crm-pure.ts";
import { dueFollowups, sendStamp } from "../src/lib/business-pure.ts";
import { signedHref } from "../src/lib/contracts-pure.ts";

test("contactKey: domain for business mail and sites, whole address for free-mail, phone digits, else name", () => {
  assert.equal(contactKey("info@Rulli.ee", "x"), "dom:rulli.ee");
  assert.equal(contactKey("https://www.rulli.ee/kontakt", "x"), "dom:rulli.ee");
  assert.equal(contactKey("rulli.ee", "x"), "dom:rulli.ee");
  assert.equal(contactKey("mari@gmail.com", "x"), "mail:mari@gmail.com");
  assert.equal(contactKey("+372 5123 4567", "x"), contactKey("51234567", "y"));
  assert.equal(contactKey("", "Kook & Co"), "name:kook co");
});

test("duplicateOf matches by stable key or name, not by unrelated rows", () => {
  const ps = [{ id: "a", name: "Rulli", contact: "info@rulli.ee" }, { id: "b", name: "Salon", contact: "" }];
  assert.equal(duplicateOf(ps, {}, "Rullimeister OÜ", "https://rulli.ee"), "a");
  assert.equal(duplicateOf(ps, {}, "salon ", "x@y.ee"), "b");
  assert.equal(duplicateOf(ps, {}, "Other", "other.ee"), null);
});

test("web finds start unverified; manual adds are verified", () => {
  assert.equal(newCrm("web-find", "x", "x.ee").verified, false);
  assert.equal(newCrm("manual", "x", "").verified, true);
});

const ev = (kind: CrmEvent["kind"], day: number): CrmEvent => ({ kind, at: new Date(Date.UTC(2026, 9, day)).toISOString() });
test("touch: last real contact ignores drafts, notes and stage changes; reply after the last send counts", () => {
  assert.equal(touch([ev("draft", 1), ev("note", 9)]), null);
  assert.deepEqual(touch([ev("sent", 1), ev("note", 9), ev("stage", 9)]), { last: ev("sent", 1).at, replied: false });
  assert.equal(touch([ev("sent", 1), ev("reply", 2)])!.replied, true);
  assert.equal(touch([ev("reply", 2), ev("sent", 3)])!.replied, false);
});

test("dueFollowups with a timeline: a later note edit does not reset the clock", () => {
  const now = Date.UTC(2026, 9, 10);
  const p = { stage: "contacted" as const, updated_at: new Date(now).toISOString(), notes: "", touch: touch([ev("sent", 1), ev("note", 10)]) };
  assert.equal(dueFollowups([p], now).length, 1);
  assert.equal(dueFollowups([{ ...p, touch: touch([ev("sent", 1), ev("reply", 3)]) }], now).length, 0);
  assert.equal(dueFollowups([{ ...p, touch: touch([ev("sent", 8)]) }], now).length, 0);
});

test("claimProblem blocks invented contact or tests unless a call or reply is logged", () => {
  assert.match(claimProblem("Hi! As we discussed, here is the idea.", []), /claims earlier contact/);
  assert.match(claimProblem("I tested your contact form response time last week.", []), /claims/);
  assert.match(claimProblem("Tere! Nagu arutasime, saadan idee.", []), /claims/);
  assert.equal(claimProblem("Tere! Märkasin, et teete tellimustorte.", []), "");
  assert.equal(claimProblem("As we discussed on the phone…", [ev("call", 1)]), "");
});

test("approval stamp binds exact recipient and body: any edit gives a new stamp", async () => {
  const base = { name: "Rulli", contact: "info@rulli.ee", draft: "Tere!" };
  const s = await sendStamp(base);
  assert.equal(await sendStamp({ ...base }), s);
  assert.notEqual(await sendStamp({ ...base, draft: "Tere!!" }), s);
  assert.notEqual(await sendStamp({ ...base, contact: "sales@rulli.ee" }), s);
});

test("addEvent caps and deliveryPlan names the client", () => {
  let c = newCrm("manual", "x", "");
  for (let i = 0; i < 205; i++) c = addEvent(c, "note", new Date(i * 1000).toISOString(), "n");
  assert.equal(c.events.length, 200);
  const d = deliveryPlan({ name: "Rulli", kind: "bakery", fee: 49 });
  assert.equal(d.name, "Deliver: Rulli");
  assert.match(d.description, /€49\/month expected/);
});

test("signedHref prefers the VAULT stable id", () => {
  assert.equal(signedHref({ pdf: "a b.pdf" }), "/api/vault?file=a%20b.pdf&raw=1");
  assert.equal(signedHref({ pdf: "a.pdf", pdfId: "abc" }), "/api/vault?file=abc&raw=1");
});
