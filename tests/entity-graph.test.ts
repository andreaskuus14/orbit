import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  birthdayNorm, claimsIn, contradictionBrief, decideEntity, emptyDecisions, findContradictions, formKey, gather, linkScore,
  mergeSuggestions, resolveEntities, valueNorm, type MemIn, type Src,
} from "../src/lib/entity-graph-pure.ts";

const src = (id: string, at = "2026-10-01T00:00:00Z"): Src => ({ id, type: "memory", title: id, at });
const mem = (id: string, content: string, o: Partial<MemIn> = {}): MemIn => ({ id, kind: "note", title: id, content, created_at: "2026-10-01T00:00:00Z", ...o });
const firsts = (...names: string[]) => { const m = new Map<string, number>(); for (const n of names) { const f = formKey(n).split(" ")[0]; m.set(f, (m.get(f) ?? 0) + 1); } return m; };

test("link scores: exact, email, unique first name, ambiguous first name, initial", () => {
  const f = firsts("Mart Tamm");
  assert.equal(linkScore("Mart Tamm", "mart  tamm", f), 1);
  assert.equal(linkScore("mart.tamm@bolt.eu", "Mart Tamm", f), 0.95);
  assert.equal(linkScore("Mart", "Mart Tamm", f), 0.85);
  assert.equal(linkScore("mart@x.ee", "Mart Tamm", f), 0.8);
  assert.equal(linkScore("Mart", "Mart Tamm", firsts("Mart Tamm", "Mart Kask")), 0.4);
  assert.equal(linkScore("M. Tamm", "Mart Tamm", f), 0.75);
  assert.equal(linkScore("Liis", "Mart Tamm", f), 0);
});

test("resolution clusters Mart / Mart Tamm / mart@… and suggests (never auto-confirms) the merge", () => {
  const m = (form: string, kind?: "person" | "project") => ({ form, kind, src: src(form) });
  const ents = resolveEntities([m("Mart", "person"), m("Mart Tamm"), m("mart@bolt.eu", "person"), m("Liis Kask"), m("Pet Sim", "project")], emptyDecisions());
  const mart = ents.find((e) => e.keys.includes("mart"))!;
  assert.deepEqual([...mart.keys].sort(), ["mart", "mart tamm", "mart@bolt.eu"]);
  assert.equal(mart.confirmed, false);
  assert.equal(mart.confidence, 0.85); // weakest link that joined the cluster (Mart ~ Mart Tamm)
  const s = mergeSuggestions(ents);
  assert.equal(s.length, 1);
  assert.match(s[0].key, /^same:[0-9a-f]{8}$/);
  assert.ok(!ents.find((e) => e.keys.includes("liis kask"))!.confirmed);
});

test("decisions: 'same' confirms the group; 'different' blocks the pair for good", () => {
  const ms = [{ form: "Mart", src: src("a") }, { form: "Mart Tamm", src: src("b") }];
  const s = mergeSuggestions(resolveEntities(ms, emptyDecisions()));
  const yes = decideEntity(emptyDecisions(), { merges: s, contradictions: [] }, s[0].key, "same");
  assert.ok(typeof yes !== "string");
  const e = resolveEntities(ms, yes);
  assert.equal(e.length, 1); assert.equal(e[0].confirmed, true);
  assert.equal(mergeSuggestions(e).length, 0);
  const no = decideEntity(emptyDecisions(), { merges: s, contradictions: [] }, s[0].key, "different");
  assert.ok(typeof no !== "string");
  assert.equal(resolveEntities(ms, no).length, 2);
  assert.equal(decideEntity(emptyDecisions(), { merges: s, contradictions: [] }, s[0].key, "maybe"), "Choose same or different");
});

test("birthday and value normalisation", () => {
  for (const s of ["3 May", "May 3rd", "3rd of May", "3. mai", "03.05", "3.5.1990", "1990-05-03"]) assert.equal(birthdayNorm(s), "05-03", s);
  assert.equal(birthdayNorm("sometime in spring"), null);
  assert.deepEqual(valueNorm("Bolt OÜ, as a designer"), { value: "Bolt OÜ", norm: "bolt" });
  assert.equal(valueNorm("a very long place name with far too many words"), null);
});

test("claims: people, the owner, Estonian; negations, pronouns and hedges skipped", () => {
  const c = claimsIn("Mart's birthday is 3 May. I live in Tartu. Liis Kask works at Bolt since 2024. Mart töötab firmas Wise. " +
    "He works at Google. Mart no longer works at Skype. They live in Riga. Mart works in marketing.", src("m"));
  assert.deepEqual(c.map((x) => [x.form, x.attr, x.norm]), [
    ["Mart", "birthday", "05-03"], ["me", "home", "tartu"], ["Liis Kask", "employer", "bolt"], ["Mart", "employer", "wise"],
  ]);
});

test("contradictions: two birthdays for Mart; agreeing notes, unconfirmed merges and decided keys stay quiet", () => {
  const d = emptyDecisions();
  const { mentions, claims } = gather({ memories: [
    mem("a", "Mart's birthday is 3 May.", { created_at: "2026-01-01T00:00:00Z" }),
    mem("b", "Remember: Mart's birthday is May 5.", { created_at: "2026-09-01T00:00:00Z" }),
    mem("c", "Mart Tamm's birthday is 9 June."), // not merged with "Mart" yet: no question
    mem("d", "Liis works at Bolt."), mem("e", "Liis works at Bolt OÜ."), // agree
  ], facts: [], people: [] });
  const cs = findContradictions(claims, resolveEntities(mentions, d), d);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].entity, "Mart");
  assert.deepEqual(cs[0].options.map((o) => [o.norm, o.src.id]), [["05-05", "b"], ["05-03", "a"]]); // newest first
  const after = decideEntity(d, { merges: [], contradictions: cs }, cs[0].key, "05-05");
  assert.ok(typeof after !== "string");
  assert.equal(findContradictions(claims, resolveEntities(mentions, after), after).length, 0);
  assert.equal(decideEntity(d, { merges: [], contradictions: cs }, cs[0].key, "12-24"), "Pick one of the answers");
  assert.match(contradictionBrief(cs)!.say, /Mart's birthday\. Which is right\?/);
});

test("contradictions group across names only after the owner confirms the merge", () => {
  const input = { memories: [mem("a", "Mart's birthday is 3 May."), mem("b", "Mart Tamm's birthday is 9 June.")], facts: [], people: [{ id: "p", name: "Mart Tamm", created_at: "2026-01-01T00:00:00Z" }] };
  const { mentions, claims } = gather(input);
  const d0 = emptyDecisions();
  assert.equal(findContradictions(claims, resolveEntities(mentions, d0), d0).length, 0);
  const s = mergeSuggestions(resolveEntities(mentions, d0));
  const d1 = decideEntity(d0, { merges: s, contradictions: [] }, s[0].key, "same");
  assert.ok(typeof d1 !== "string");
  const cs = findContradictions(claims, resolveEntities(mentions, d1), d1);
  assert.equal(cs.length, 1); assert.equal(cs[0].entity, "Mart Tamm");
});

test("owner beliefs (memory_facts) count as claims about 'me'", () => {
  const { claims } = gather({ memories: [mem("a", "I work at Wise.")], facts: [{ id: "f", statement: "My employer is Bolt", status: "current", created_at: "2026-10-02T00:00:00Z" }, { id: "g", statement: "My employer is Skype", status: "superseded", created_at: "2025-01-01T00:00:00Z" }], people: [] });
  const cs = findContradictions(claims, [], emptyDecisions());
  assert.equal(cs.length, 1);
  assert.deepEqual(cs[0].options.map((o) => o.src.type), ["fact", "memory"]);
});

test("journal (LIFE) never enters the scan, and the job never imports a model client", () => {
  const { mentions, claims } = gather({ memories: [mem("j", "Mart's birthday is 3 May. Mart Tamm mart@x.ee", { kind: "journal" })], facts: [], people: [] });
  assert.equal(mentions.length, 0); assert.equal(claims.length, 0);
  const io = readFileSync(new URL("../src/lib/entity-graph.ts", import.meta.url), "utf8");
  assert.match(io, /\.neq\("kind", "journal"\)/);
  assert.match(io, /usable\(|gather\(/);
  assert.doesNotMatch(io, /from "\.\/claude"|askClaude|import\("\.\/claude"\)/);
});
