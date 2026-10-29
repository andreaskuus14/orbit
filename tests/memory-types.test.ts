import { test } from "node:test";
import assert from "node:assert/strict";
import { currentOnly, isCurrent, scopeOfRecord, scopeTags, memoryType, resolveClaims, temporaryOf, typeLabel, weight } from "../src/lib/memory-types-pure.ts";
import { extractFacts, factsBlock, planFact, type Fact } from "../src/lib/facts-pure.ts";
import { correctionRecords, derivedFrom, forgetPlan } from "../src/lib/provenance-pure.ts";
import { findContradictions, type Claim, type Src } from "../src/lib/entity-graph-pure.ts";

const T0 = "2026-10-01T00:00:00.000Z", now0 = Date.parse(T0), DAY = 86_400_000;
const mem = (id: string, o: Record<string, unknown> = {}) => ({ id, kind: "note", title: id, content: "x", source: "capture", created_at: T0, tags: [] as string[], ...o });

test("24: types from existing provenance fields", () => {
  assert.equal(memoryType(mem("a", { kind: "preference" })), "preference");
  assert.equal(memoryType(mem("a", { content: "I prefer short videos" })), "preference");
  assert.equal(memoryType(mem("a", { content: "The game launches in May" })), "fact");
  assert.equal(memoryType(mem("a", { confirmation: "suggested" })), "inferred");
  assert.equal(memoryType({ statement: "x", source: "inferred", created_at: T0 }), "inferred");
  assert.equal(memoryType(mem("a", { source: "news" })), "observation");
  assert.equal(memoryType(mem("a", { content: "Use dark thumbnails this week" })), "temporary");
  assert.equal(memoryType(mem("a", { tags: ["superseded"] })), "superseded");
  assert.match(typeLabel(mem("a", { confirmation: "suggested" })), /inferred belief/);
  assert.match(typeLabel(mem("a", { content: "Skip shorts for now" })), /temporary instruction until 2026-10-08/);
});

test("24: temporary instructions expire and keep their scope", () => {
  assert.equal(temporaryOf("I like tea", T0), null);
  assert.equal(temporaryOf("for the next 3 days, no calls", T0)!.expiresAt, now0 + 3 * DAY);
  assert.equal(temporaryOf("until 2026-10-05 post daily", T0)!.expiresAt, Date.parse("2026-10-05T21:00:00Z")); // Tallinn midnight
  const t = mem("t", { content: "No music today" });
  assert.ok(isCurrent(t, { now: now0 + 1000 }));
  assert.ok(!isCurrent(t, { now: now0 + 2 * DAY }));
  const p = mem("p", { content: "Use British spelling", tags: ["scope:ORBIT"] });
  assert.ok(isCurrent(p, { now: now0, project: "orbit" }) && !isCurrent(p, { now: now0, project: "Pet Sim" }) && !isCurrent(p, { now: now0 }));
});

test("24: a temporary fact never supersedes the durable preference, and lapses", () => {
  assert.equal(extractFacts("I prefer tea for now")[0].subject, "tea (for now)");
  const [c] = extractFacts("For now I prefer tea");
  assert.equal(c.subject, "tea (for now)");
  const durable = { id: "d", subject: "tea", statement: "I prefer coffee", status: "current" as const };
  assert.deepEqual(planFact([{ ...durable, subject: "coffee" }], c), { op: "insert", supersede: [] });
  const f = (id: string, subject: string, statement: string): Fact => ({ id, subject, statement, status: "current", source: "user_said", source_ref: null, confidence: 0.8, supersedes: null, superseded_by: null, created_at: T0, updated_at: T0, superseded_at: null, restored_from: null });
  const facts = [f("1", "coffee", "I prefer coffee"), f("2", c.subject, c.statement)];
  assert.match(factsBlock(facts, "drink", 600, now0 + DAY), /for now\): For now I prefer tea \[temporary/);
  const later = factsBlock(facts, "drink", 600, now0 + 30 * DAY);
  assert.match(later, /I prefer coffee/);
  assert.doesNotMatch(later, /tea/);
});

test("25: a correction supersedes in retrieval, keeps history, respects scope", () => {
  const orig = mem("o", { content: "Deadline is Friday" });
  const g = correctionRecords(orig, "Deadline is Monday");
  assert.equal(g.scoped, false);
  const copy = { ...g.insert, id: "h", created_at: T0 };
  assert.deepEqual(currentOnly([orig, copy], { now: now0 }).map((r) => r.id), ["o"]); // history copy never current
  const s = correctionRecords(orig, "Deadline is Monday", "Pet Sim");
  const fix = { ...s.insert, id: "c", created_at: T0 };
  assert.deepEqual(currentOnly([orig, fix], { now: now0, project: "pet sim" }).map((r) => r.id), ["c"]);
  assert.deepEqual(currentOnly([orig, fix], { now: now0, project: "ORBIT" }).map((r) => r.id), ["o"]);
  assert.equal(weight(fix), 4);
  // later corrections don't rewrite history; Forget removes it with the original
  const rows = [copy, fix, { id: "sum", tags: ["o"], source_ref: null }];
  assert.deepEqual(derivedFrom("o", rows), ["sum"]);
  assert.deepEqual(forgetPlan("o", rows).delete, ["o", "h", "c"]);
});

test("26: correction > provenance > recency; durable preference beats newer observation; ties between owner statements asked", () => {
  assert.equal(resolveClaims([{ weight: 3, at: "1" }, { weight: 2, at: "9" }])!.at, "1");
  assert.equal(resolveClaims([{ weight: 4, at: "1" }, { weight: 3, at: "9" }])!.weight, 4);
  assert.equal(resolveClaims([{ weight: 2, at: "1" }, { weight: 2, at: "9" }])!.at, "9");
  assert.equal(resolveClaims([{ weight: 3, at: "1" }, { weight: 3, at: "9" }]), null);
  const src = (id: string, at: string, w?: number): Src => ({ id, type: "memory", title: id, at, weight: w });
  const claim = (v: string, s: Src): Claim => ({ form: "me", attr: "home", value: v, norm: v, src: s });
  const d = { same: [], different: [], contra: {} };
  assert.equal(findContradictions([claim("tallinn", src("a", "1", 3)), claim("tartu", src("b", "9", 2))], [], d).length, 0);
  assert.equal(findContradictions([claim("tallinn", src("a", "1", 3)), claim("tartu", src("b", "9", 3))], [], d).length, 1);
});

// C01/C02 (autonomy roadmap): originating chat, explicit durations, EN + ET pairs.
const A = "11111111-aaaa-4bbb-8ccc-000000000001", B = "22222222-aaaa-4bbb-8ccc-000000000002";
const saved = (text: string, chat: string | null, created = T0) => mem("s", { content: text, created_at: created, tags: scopeTags(text, [], { chat }) });

for (const [lang, text] of [["en", "In this chat, answer in bullet points"], ["et", "Selles vestluses vasta punktidena"]]) {
  test(`C01 ${lang}: a chat-scoped instruction is eligible only in its own chat, even one second later`, () => {
    const m = saved(text, A);
    assert.ok(isCurrent(m, { now: now0 + 1000, chat: A }));
    assert.ok(!isCurrent(m, { now: now0 + 1000, chat: B }));
    assert.ok(!isCurrent(m, { now: now0 + 1000 })); // brief, agents, search: no chat context
    assert.ok(isCurrent(m, { now: now0 + 30 * DAY, chat: A })); // no invented 12 h lapse
    assert.ok(!isCurrent(mem("x", { content: text }), { now: now0, chat: A })); // no originating chat id: fails closed
    assert.deepEqual(currentOnly([m], { now: now0, chat: B }), []);
  });
}

test("C01: a model cannot forge chat/until tags; project wording pins the project", () => {
  assert.deepEqual(scopeTags("Use tabs", ["chat:x", "until:revoked", "revoked", "ok"], { chat: A }), ["ok"]);
  assert.deepEqual(scopeTags("For this project use British spelling", [], { chat: A, project: "ORBIT" }), ["scope:ORBIT"]);
  assert.deepEqual(scopeTags("Selles projektis kasuta briti kirjaviisi", [], { project: "Pet Sim" }), ["scope:Pet Sim"]);
  const p = mem("p", { content: "Selles projektis kasuta briti kirjaviisi", tags: ["scope:Pet Sim"] });
  assert.ok(isCurrent(p, { now: now0, project: "pet sim" }) && !isCurrent(p, { now: now0, project: "ORBIT" }) && !isCurrent(p, { now: now0 }));
  assert.deepEqual(extractFacts("Don't use emojis in this chat"), []); // facts carry no chat id
});

for (const [lang, text] of [["en", "Until further notice, keep replies short"], ["et", "Kuni edasiseni vasta lühidalt"]]) {
  test(`C02 ${lang}: "until further notice" stays until revoked, then stops`, () => {
    const m = mem("u", { content: text });
    assert.equal(scopeOfRecord(m).until, "revoked");
    assert.equal(scopeOfRecord(m).expiresAt, null);
    assert.equal(memoryType(m), "temporary");
    assert.ok(isCurrent(m, { now: now0 + 400 * DAY }));
    assert.match(typeLabel(m), /until revoked/);
    assert.ok(!isCurrent({ ...m, tags: ["revoked"] }, { now: now0 + DAY })); // owner revokes
  });
}

// 2026-10-29 21:30 UTC = 23:30 in Tallinn (EET, UTC+2 after the DST change on 25 Oct).
const LATE = "2026-10-29T21:30:00.000Z";
for (const [lang, text] of [["en", "Today answer briefly"], ["et", "Täna vasta lühidalt"]]) {
  test(`C02 ${lang}: "today" is temporary and ends at the Europe/Tallinn date boundary`, () => {
    const m = mem("t", { content: text, created_at: LATE });
    assert.equal(memoryType(m), "temporary"); // not a permanent fact
    assert.equal(scopeOfRecord(m).until, "today");
    assert.equal(scopeOfRecord(m).expiresAt, Date.parse("2026-10-29T22:00:00Z"));
    assert.ok(isCurrent(m, { now: Date.parse("2026-10-29T21:59:00Z") }));
    assert.ok(!isCurrent(m, { now: Date.parse("2026-10-29T22:00:00Z") })); // UTC is still the 29th
    const summer = mem("s", { content: text, created_at: "2026-07-01T20:30:00Z" }); // 23:30 EEST
    assert.equal(scopeOfRecord(summer).expiresAt, Date.parse("2026-07-01T21:00:00Z"));
  });
}

for (const [lang, text, until] of [["en", "For the next 3 days no calls", "days"], ["et", "Järgmised 3 päeva ära helista", "days"], ["en", "until 2026-11-02 post daily", "date"], ["et", "kuni 2026-11-02 postita iga päev", "date"]]) {
  test(`C02 ${lang}: explicit duration "${text}"`, () => {
    const s = scopeOfRecord(mem("d", { content: text }));
    assert.equal(s.until, until);
    assert.equal(s.expiresAt, until === "days" ? now0 + 3 * DAY : Date.parse("2026-11-02T22:00:00Z")); // 3 Nov 00:00 EET
  });
}

test("C02: durable preferences get no invented expiry; the owner can edit the duration", () => {
  for (const t of ["I prefer short answers", "Eelistan lühikesi vastuseid"]) assert.equal(scopeOfRecord(mem("d", { content: t })).expiresAt, null);
  const today = mem("e", { content: "Täna vasta lühidalt" });
  assert.ok(isCurrent({ ...today, tags: ["until:revoked"] }, { now: now0 + 90 * DAY }));
  const dated = { ...today, tags: ["until:2026-10-03"] };
  assert.ok(isCurrent(dated, { now: Date.parse("2026-10-03T20:59:00Z") }) && !isCurrent(dated, { now: Date.parse("2026-10-03T21:00:00Z") }));
  assert.match(typeLabel(dated), /until 2026-10-03/);
});
