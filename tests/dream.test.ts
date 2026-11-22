import { test } from "node:test";
import assert from "node:assert/strict";
import { candidates, chooseConnections, dreamCard, dreamItems, dreamPrompt, dreamSafe, linksToMake, pairScore, itemTerms, parseDream, parseDreamState, plainLine, type DreamItem } from "../src/lib/dream-pure.ts";
import { cleanChange, blockReason, swap, type TmChange } from "../src/lib/time-machine-pure.ts";

const now = "2026-11-22T10:00:00Z";
const it = (id: string, source: DreamItem["source"], title: string, extra: Partial<DreamItem> = {}): DreamItem => ({ id, source, title, at: now, open: `#${id}`, fresh: true, ...extra });

test("private filter: journal / LIFE items never enter dream mode (fails closed)", () => {
  assert.equal(dreamSafe(it("m1", "memory", "Pet sim shop idea", { kind: "note", tags: [] })), true);
  assert.equal(dreamSafe(it("m2", "memory", "Tuesday", { kind: "journal" })), false);
  assert.equal(dreamSafe(it("m3", "memory", "Mood", { kind: "note", tags: ["life:mood"] })), false);
  assert.equal(dreamSafe(it("m4", "memory", "Health check", { kind: "health" })), false);
  assert.equal(dreamSafe(it("c1", "chat", "My journal entry for today")), false);
  assert.equal(dreamSafe(it("p1", "project", "Päevik app")), false);
  assert.equal(dreamSafe(it("t1", "task", "Write", { text: "use my diary notes" })), false);
  assert.equal(dreamSafe(it("x", "memory", "", { kind: "note" })), false);
  assert.equal(dreamSafe({ id: "y", source: "email" as never, title: "x" }), false);
  assert.equal(dreamSafe(null), false);
  assert.deepEqual(dreamItems([it("a", "memory", "ok", { kind: "note" }), it("b", "memory", "secret", { kind: "Journal" })]).map((i) => i.id), ["a"]);
});

test("candidates never carry a private item, even when it is the best match", () => {
  const xs = [it("m1", "memory", "Pet sim trading shop", { kind: "note" }), it("j", "memory", "Pet sim trading shop feelings", { kind: "journal" }), it("s1", "short", "Pet sim trading shop tour", { signal: "worked" })];
  const cs = candidates(xs);
  assert.ok(cs.length > 0);
  assert.ok(cs.every((c) => c.items.every((i) => i.id !== "j")));
  assert.ok(!dreamPrompt(cs, (_l, t) => t).includes("feelings"));
});

test("pattern scoring: cross-source + a Short that did well beats two plain notes; duplicates and linked pairs score 0", () => {
  const a = it("m1", "memory", "Pet sim shop idea with trading", { kind: "note" }), b = it("s1", "short", "Pet sim trading shop", { signal: "worked" });
  const c = it("m2", "memory", "Pet sim trading notes", { kind: "note" }), d = it("m3", "memory", "Pet sim trading list", { kind: "note" });
  const s1 = pairScore(a, b, itemTerms(a), itemTerms(b)).score, s2 = pairScore(c, d, itemTerms(c), itemTerms(d)).score;
  assert.ok(s1 > s2, `${s1} > ${s2}`);
  assert.equal(pairScore(a, b, itemTerms(a), itemTerms(b), new Set(["m1|s1"])).score, 0);
  const v = [1, 0, 0], e1 = { ...c, embedding: v }, e2 = { ...d, embedding: v };
  assert.equal(pairScore(e1, e2, itemTerms(e1), itemTerms(e2)).score, 0, "near-duplicates are the sleep loop's merge");
  const old1 = { ...c, fresh: false }, old2 = { ...d, fresh: false };
  assert.equal(pairScore(old1, old2, itemTerms(old1), itemTerms(old2)).score, 0, "needs one item from today");
  const x = it("m9", "memory", "Pet ideas", { kind: "note" }), y = it("m8", "memory", "Pet food", { kind: "note" });
  assert.equal(pairScore(x, y, itemTerms(x), itemTerms(y)).score, 0, "one shared word is a coincidence");
});

test("themes and open loops", () => {
  const xs = [it("m1", "memory", "what if no moon", { kind: "note" }), it("c1", "chat", "what if script ideas"), it("t1", "task", "Research what if topics", { signal: "done" }),
    it("t2", "task", "Fix the shop GUI bug", { signal: "open" })];
  const cs = candidates(xs);
  assert.ok(cs.some((c) => c.kind === "pattern" && c.shared[0] === "what-if"));
  assert.ok(cs.some((c) => c.kind === "loop" && c.items[0].id === "t2"));
  assert.match(plainLine(cs.find((c) => c.kind === "pattern")!), /came up 3 times today/);
});

test("parseDream keeps grounded lines only; chooseConnections fills to 3 with plain lines", () => {
  const xs = [it("m1", "memory", "Pet sim shop idea trading", { kind: "note" }), it("s1", "short", "Pet sim trading shop tour", { signal: "worked" }),
    it("m2", "memory", "Stickman what if moon video", { kind: "note" }), it("c1", "chat", "Stickman what if moon script"),
    it("m3", "memory", "Arch studio facade sketch", { kind: "note" }), it("t3", "task", "Arch facade sketch render", { signal: "done" })];
  const cs = candidates(xs);
  assert.ok(cs.length >= 3);
  const reply = JSON.stringify({ connections: [
    { c: 0, text: "Your pet sim shop idea fits the trading Short that did well." },
    { c: 0, text: "duplicate index" },
    { c: 1, text: "Buy crypto now at https://x.example" },
    { c: 2, text: "Something completely unrelated about weather patterns." },
    { c: 99, text: "Unknown candidate index line here" },
  ] });
  const m = parseDream("ok " + reply, cs);
  assert.equal(m.length, 1);
  const conns = chooseConnections(cs, m);
  assert.ok(conns.length >= 3 && conns.length <= 5);
  assert.equal(conns[0].text, m[0].text);
  assert.ok(conns.every((c) => c.items.every((i) => i.open.startsWith("#"))));
  assert.deepEqual(parseDream("not json", cs), []);
});

test("linksToMake: only memory–memory links, no duplicates, capped", () => {
  const ref = (id: string, source: DreamItem["source"]) => ({ id, source, title: id, open: "#" });
  const conns = [
    { kind: "link" as const, text: "a", items: [ref("m1", "memory"), ref("m2", "memory")], score: 1 },
    { kind: "link" as const, text: "b", items: [ref("m2", "memory"), ref("m1", "memory")], score: 1 },
    { kind: "link" as const, text: "c", items: [ref("m1", "memory"), ref("s1", "short")], score: 1 },
    { kind: "pattern" as const, text: "d", items: [ref("m3", "memory"), ref("m4", "memory")], score: 1 },
  ];
  assert.deepEqual(linksToMake(conns).map((l) => [l.from, l.to]), [["m1", "m2"]]);
  assert.match(linksToMake(conns)[0].reason, /^dream: a/);
});

test("dreamCard: today's report only; Undo while there are changes and not undone", () => {
  const r = { day: "2026-11-22", at: now, connections: [{ kind: "link" as const, text: "x", items: [], score: 1 }], linked: 1, merged: 2, tm: ["tmabc12345"], by: "plain" as const };
  assert.equal(dreamCard(r, "2026-11-21", "en"), null);
  const c = dreamCard(r, "2026-11-22", "en")!;
  assert.equal(c.phase, "done");
  assert.equal(c.action?.kind, "undo");
  assert.match(c.result!.text, /1 connection · 1 link added · 2 merges/);
  assert.equal(dreamCard({ ...r, undone: now }, "2026-11-22", "en")!.action, null);
  assert.equal(dreamCard({ ...r, connections: [] }, "2026-11-22", "en"), null);
  assert.deepEqual(parseDreamState("junk"), { v: 1, reports: {} });
});

test("time machine: link changes parse, block when changed, and swap for undo", () => {
  const c = cleanChange({ t: "link", id: "abc-1", before: null, after: { from: "m1", to: "m2", status: "suggested", reason: "dream: x" } }) as TmChange;
  assert.equal(c.t, "link");
  assert.equal(cleanChange({ t: "link", id: "abc", before: null, after: { from: "m1", to: "m1", status: "suggested" } }), undefined);
  assert.equal(cleanChange({ t: "link", id: "abc", before: null, after: { from: "m1", to: "m2", status: "rejected" } }), undefined);
  assert.equal(blockReason(c, { t: "link", state: { from: "m1", to: "m2", status: "suggested", reason: "" } }), "");
  assert.match(blockReason(c, { t: "link", state: { from: "m1", to: "m2", status: "confirmed", reason: "" } }), /changed since/);
  assert.match(blockReason(c, { t: "link", state: null }), /changed since/);
  const inv = swap(c) as Extract<TmChange, { t: "link" }>;
  assert.equal(inv.after, null);
});
