import { test } from "node:test";
import assert from "node:assert/strict";
import { currentOnly, isCurrent, memoryType, resolveClaims, temporaryOf, typeLabel, weight } from "../src/lib/memory-types-pure.ts";
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
  assert.equal(temporaryOf("until 2026-10-05 post daily", T0)!.expiresAt, Date.parse("2026-10-06"));
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
