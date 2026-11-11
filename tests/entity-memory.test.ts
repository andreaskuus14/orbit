import { test } from "node:test";
import assert from "node:assert/strict";
import { decideEntity, emptyDecisions, gather, mergeSuggestions, prospectIds, resolveGraph, type MemIn } from "../src/lib/entity-graph-pure.ts";
import { entityBlock, entityCards, factEntityId, pickCards, validity, withFacts, type Card } from "../src/lib/entity-memory-pure.ts";
import { correctionCase, correctionLesson, decide, addCorrection, type Stored } from "../src/lib/lessons-pure.ts";
import { looksSecret } from "../src/lib/reflect-pure.ts";

const mem = (id: string, content: string, at = "2026-10-01T00:00:00Z", o: Partial<MemIn> = {}): MemIn => ({ id, kind: "note", title: id, content, created_at: at, ...o });
const web = { source: "web" }; // observations: the newer one wins outright
const scan = (x: Parameters<typeof gather>[0], d = emptyDecisions()) => {
  const { mentions, claims } = gather(x), { ents, related } = resolveGraph(mentions, d);
  return { claims, ents, related, cards: entityCards(claims, ents, d), merges: mergeSuggestions(ents, 5, { related, claims }) };
};

test("a newer claim closes the old one: current first, the old value kept as outdated with its validity window", () => {
  const { cards } = scan({ memories: [mem("m1", "Mart Tamm works at Wise.", "2026-01-05T00:00:00Z", web), mem("m2", "Mart Tamm works at Bolt.", "2026-09-01T00:00:00Z", web)], facts: [], people: [] });
  const c = cards.find((x) => x.name === "Mart Tamm")!;
  assert.deepEqual(c.current.map((l) => l.value), ["Bolt"]);
  assert.deepEqual(c.outdated.map((l) => [l.value, l.from, l.until]), [["Wise", "2026-01-05", "2026-09-01"]]);
  const block = entityBlock([c]);
  assert.ok(block.indexOf("employer: Bolt") < block.indexOf("[outdated, valid 2026-01-05 to 2026-09-01] employer: Wise"));
});

test("a tie between his own notes stays disputed, never silently current", () => {
  const { cards } = scan({ memories: [mem("a", "Liis Kask lives in Tartu.", "2026-02-01T00:00:00Z"), mem("b", "Liis Kask lives in Narva.", "2026-03-01T00:00:00Z")], facts: [], people: [] });
  const c = cards.find((x) => x.name === "Liis Kask")!;
  assert.deepEqual(c.current.map((l) => [l.value, !!l.disputed]).sort(), [["Narva", true], ["Tartu", true]]);
  assert.equal(c.outdated.length, 0);
  assert.match(entityBlock([c]), /\[disputed\] home: Narva/);
});

test("belief validity comes from memory_facts history (superseded_at), and a predecessor shows as outdated", () => {
  const old = { id: "f1", subject: "pet sim release", statement: "My pet sim release is in May", status: "superseded", created_at: "2026-03-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z", superseded_at: "2026-05-20T00:00:00Z" };
  const now = { id: "f2", subject: "pet sim release", statement: "My pet sim release is in June", status: "current", created_at: "2026-05-20T00:00:00Z", supersedes: "f1" };
  assert.deepEqual(validity(old), { from: "2026-03-01T00:00:00Z", until: "2026-05-20T00:00:00Z" });
  assert.deepEqual(validity(now as never), { from: "2026-05-20T00:00:00Z", until: null });
  assert.deepEqual(validity({ ...old, status: "retracted", superseded_at: null }), { from: old.created_at, until: old.updated_at }, "marked wrong: valid until then");
  const card: Card = { id: "project:pet sim", name: "Pet Sim", kind: "project", names: ["Pet Sim"], current: [], outdated: [], refs: [] };
  const c = withFacts(card, [old, now]);
  assert.deepEqual(c.current.map((l) => l.value), ["My pet sim release is in June"]);
  assert.deepEqual(c.outdated.map((l) => [l.from, l.until]), [["2026-03-01", "2026-05-20"]]);
});

test("beliefs attach to the entity named in their subject (longest name), else the owner", () => {
  const cards: Card[] = [
    { id: "project:pet", name: "Pet", kind: "project", names: ["Pet"], current: [], outdated: [], refs: [] },
    { id: "project:pet sim", name: "Pet Sim", kind: "project", names: ["Pet Sim", "pet simulator"], current: [], outdated: [], refs: [] },
  ];
  assert.equal(factEntityId("pet simulator release date", cards), "project:pet sim");
  assert.equal(factEntityId("timezone", cards), "me");
  assert.equal(factEntityId("carpet", cards), "me", "whole words only");
});

test("CORE block: grouped per entity, only entities named in the question, whole cards within the cap", () => {
  const mk = (id: string, name: string, n: number): Card => ({ id, name, kind: "person", names: [name], refs: [{ type: "memory", id: "m-" + id, title: "note" }],
    current: Array.from({ length: n }, (_, i) => ({ attr: "employer", value: `Co${i}`, from: "2026-01-01", src: "note" })), outdated: [] });
  const cards = [mk("person:1", "Mart Tamm", 1), mk("person:2", "Liis Kask", 1), mk("person:3", "Ott Saar", 1)];
  assert.deepEqual(pickCards(cards, "What does Mart Tamm do now? And Liis Kask?").map((c) => c.id).sort(), ["person:1", "person:2"]);
  assert.deepEqual(pickCards(cards, "hello"), []);
  const block = entityBlock(cards, 400);
  assert.ok(block.length <= 400);
  assert.equal((block.match(/<entity /g) ?? []).length, (block.match(/<\/entity>/g) ?? []).length, "never a cut card");
  assert.ok(block.includes('<entity id="person:1" kind="person" name="Mart Tamm">'));
  assert.ok(block.includes('appears in: MEMORY "note" (id m-person:1)'));
  assert.equal(entityBlock([]), "");
  assert.ok(!entityBlock([{ ...cards[0], name: '<x">' }]).includes('<x">'), "names are escaped");
});

test("one identity across BUSINESS and MEMORY: same company, stable BUSINESS id, sources from both modules", () => {
  const { cards } = scan({ memories: [mem("m1", "Met the owner of Kohvik Kask (kohvikkask.ee) at the fair.")], facts: [], people: [],
    prospects: [{ id: "p9", name: "Kohvik Kask", contact: "info@kohvikkask.ee", created_at: "2026-09-01T00:00:00Z" }] });
  const c = cards.find((x) => x.id === "prospect:p9")!;
  assert.ok(c, "card keyed by the BUSINESS id");
  assert.deepEqual(c.refs.map((r) => r.type).sort(), ["memory", "prospect"]);
  assert.deepEqual(prospectIds({ id: "p1", contact: "kask@gmail.com" }), ["prospect:p1"], "a free-mail host is no company id");
});

test("linking a company across modules is only suggested with 2 signals, needs his click, and is never auto-merged", () => {
  const memories = [mem("m1", "Lunch at Kohvikkask Tartu (kohvikkask.ee) was good.")];
  const prospect = (contact: string) => [{ id: "p9", name: "Kohvikkask", contact, created_at: "2026-09-01T00:00:00Z" }];
  // Name rule only (contact is a free-mail address): one signal, no suggestion.
  assert.equal(scan({ memories, facts: [], people: [], prospects: prospect("kask@gmail.com") }).merges.length, 0);
  // Name rule + the same domain: two signals, suggested, but still two separate cards until he confirms.
  const s = scan({ memories, facts: [], people: [], prospects: prospect("https://kohvikkask.ee") });
  assert.equal(s.merges.length, 1);
  assert.deepEqual(s.merges[0].evidence!.map((e) => e.code).sort(), ["first", "id"]);
  assert.equal(s.cards.filter((c) => c.refs.some((r) => r.id === "m1") && c.refs.some((r) => r.id === "p9")).length, 0, "not merged before his click");
  // His click: one identity under the BUSINESS id.
  const d = decideEntity(emptyDecisions(), { merges: s.merges, contradictions: [] }, s.merges[0].key, "same");
  assert.ok(typeof d !== "string");
  const after = scan({ memories, facts: [], people: [], prospects: prospect("https://kohvikkask.ee") }, d);
  const one = after.cards.find((c) => c.id === "prospect:p9")!;
  assert.ok(one.refs.some((r) => r.id === "m1"), "confirmed: memory joins the BUSINESS identity");
});

test("journal (LIFE) never reaches an entity card", () => {
  const { cards } = scan({ memories: [mem("j", "Mart Tamm works at Bolt.", undefined, { kind: "journal" })], facts: [], people: [] });
  assert.equal(cards.length, 0);
});

test("a kept correction becomes a golden eval case (input, wrong output summary, expected behaviour)", () => {
  const NOW = Date.parse("2026-11-02T10:00:00Z");
  const l = correctionLesson("Don't use bullet points for status updates", "Here are 5 bullet points about your channel", "msg-1", NOW)!;
  const [stored] = addCorrection([], l).lessons;
  assert.equal(correctionCase(stored, "How is my channel doing?", looksSecret), null, "only once he keeps it");
  const kept = (decide([stored], stored.id, "keep", NOW) as Stored[])[0];
  const c = correctionCase(kept, "How is my channel doing?", looksSecret)!;
  assert.deepEqual({ ...c, created: "" }, { id: "correction-msg-1", kind: "correction", created: "", input: "How is my channel doing?",
    wrong_output_summary: "Here are 5 bullet points about your channel", correction: "Don't use bullet points for status updates",
    expected_behaviour: "Don't use bullet points for status updates", source: "message:msg-1" });
  assert.equal(correctionCase(kept, "", looksSecret), null, "no request, no case");
  assert.equal(correctionCase(kept, "my key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", looksSecret), null, "never a secret"); // secret-scan: allow (fake test value)
  assert.equal(correctionCase(kept, "How is my channel doing?", looksSecret, ["search_memory", "life_journal"]), null, "a chat that touched LIFE is skipped");
  assert.ok(correctionCase(kept, "How is my channel doing?", looksSecret, ["search_memory", "web_search"]), "other tools are fine");
  assert.equal(correctionCase(kept, "Read my journal entry about Tuesday", looksSecret), null, "journal words are skipped");
});
