import { test } from "node:test";
import assert from "node:assert/strict";
import { businessTouches, checkinPrompt, likeSafe, mentioned, overdue, ownNotes, peopleBlock, recency, ringLayout, timeline, validateLog, validatePerson, DAY } from "../src/lib/people-pure.ts";

const now = Date.parse("2026-10-26T12:00:00Z");
const ago = (d: number) => new Date(now - d * DAY).toISOString();

test("validatePerson: add needs a name and fills defaults; patch takes only what was sent", () => {
  assert.equal(validatePerson({}, true), "Give the person a name");
  assert.deepEqual(validatePerson({ name: " Mari " }, true), { name: "Mari", relation: "", notes: "", cares: "", next: "", affinity: "life", importance: 3, remindDays: 21, prospectId: null });
  assert.equal(validatePerson({ affinity: "work" }, false), "Affinity must be business, studio, roblox or life");
  assert.equal(validatePerson({ importance: 9 }, false), "Importance must be 1–5");
  assert.equal(validatePerson({ notes: null }, false), "notes must be text");
  assert.equal(validatePerson({ prospectId: "x" }, false), "Bad prospect id");
  assert.equal(validatePerson({}, false), "Nothing to change");
  assert.deepEqual(validatePerson({ importance: "5", remindDays: 7 }, false), { importance: 5, remindDays: 7 });
});

test("validateLog defaults to now and refuses the future", () => {
  assert.equal(validateLog({ note: " " }, now), "Say what happened, e.g. 'called about the pilot'");
  assert.deepEqual(validateLog({ note: "called" }, now), { at: new Date(now).toISOString(), note: "called" });
  assert.equal(validateLog({ note: "x", at: ago(-2) }, now), "Bad date");
});

test("ownNotes drops the web research section", () => {
  assert.equal(ownNotes("Loves cakes\n\nResearch (web, unchecked):\nSells: x\n(end research)"), "Loves cakes");
  assert.equal(ownNotes("Research (web, unchecked):\nSells: x"), "");
});

test("timeline merges sources newest first; business events only count real contact stages", () => {
  const ev = [
    { created_at: ago(10), payload: { prospect: "p1", to: "contacted" } },
    { created_at: ago(9), payload: { prospect: "p1", to: "lead" } },
    { created_at: ago(2), payload: { prospect: "p2", to: "replied" } },
  ];
  const tl = timeline(businessTouches(ev, "p1"), [{ at: ago(3), what: "called", via: "logged" }, { at: ago(3), what: "called", via: "logged" }]);
  assert.deepEqual(tl.map((t) => t.what), ["called", "Contacted"]);
});

test("recency fades over a month; never contacted is dim", () => {
  assert.equal(recency(null, now), 0.15);
  assert.equal(recency(ago(0), now), 1);
  assert.ok(Math.abs(recency(ago(30), now) - Math.exp(-1)) < 1e-9);
  assert.equal(recency(ago(400), now), 0.15);
});

test("overdue: only important people, after remindDays (from when he added them if never contacted)", () => {
  const p = { importance: 4, remindDays: 14, created_at: ago(100) };
  assert.equal(overdue(p, ago(13), now), false);
  assert.equal(overdue(p, ago(14), now), true);
  assert.equal(overdue({ ...p, importance: 3 }, ago(90), now), false);
  assert.equal(overdue({ ...p, created_at: ago(5) }, null, now), false);
  assert.equal(overdue(p, null, now), true);
});

test("mentioned: whole words, accents folded, unique first names only", () => {
  const ps = [{ name: "Mari Tamm" }, { name: "Jüri Kask" }, { name: "Mark Lee" }, { name: "Mark Ots" }, { name: "Al" }];
  assert.deepEqual(mentioned("draft something for juri", ps).map((p) => p.name), ["Jüri Kask"]);
  assert.deepEqual(mentioned("Remind me about Mari", ps).map((p) => p.name), ["Mari Tamm"]);
  assert.deepEqual(mentioned("what did mark say", ps), []); // two Marks: ambiguous
  assert.deepEqual(mentioned("what did Mark Ots say", ps).map((p) => p.name), ["Mark Ots"]);
  assert.deepEqual(mentioned("Marianne and almonds", ps), []);
});

test("likeSafe strips filter syntax and too-short names", () => {
  assert.equal(likeSafe("Ann,(x).%_*"), "Ann x");
  assert.equal(likeSafe("O'Neil"), "O_Neil");
  assert.equal(likeSafe("Al"), "");
});

test("peopleBlock gives name, relation and last contact only", () => {
  assert.equal(peopleBlock([], now), "");
  const b = peopleBlock([{ name: "Mari", relation: "client", last: ago(3) }, { name: "Jüri", relation: "", last: null }], now);
  assert.match(b, /Mari \(client\): last contact 3 days ago \(2026-10-23\)/);
  assert.match(b, /Jüri: last contact unknown/);
});

test("checkinPrompt is JSON data with the latest five moments", () => {
  const tl = Array.from({ length: 7 }, (_, i) => ({ at: ago(i + 1), what: `t${i}`, via: "logged" as const }));
  const j = JSON.parse(checkinPrompt({ name: "Mari", relation: "client", notes: "n", cares: "speed", next: "demo" }, tl, now).slice("Person data: ".length));
  assert.equal(j.daysSinceContact, 1);
  assert.equal(j.recent.length, 5);
  assert.equal(j.caresAbout, "speed");
});

test("ringLayout puts every moon on the ring, grouped by affinity", () => {
  const pos = ringLayout(["life", "business", "business", "roblox"], 10);
  assert.equal(pos.length, 4);
  for (const [x, y] of pos) assert.ok(Math.abs(Math.hypot(x, y) - 10) <= 0.5);
  const ang = (i: number) => (Math.atan2(pos[i][1], pos[i][0]) + 2 * Math.PI) % (2 * Math.PI);
  assert.ok(ang(1) < Math.PI / 2 && ang(2) < Math.PI / 2); // business: first quarter
});
