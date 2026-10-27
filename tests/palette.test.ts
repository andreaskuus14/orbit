import { test } from "node:test";
import assert from "node:assert/strict";
import { score, rank, fold, pushRecent, parseRecent, prospectRows, rowsOf } from "../src/lib/palette-pure.ts";

test("tiers: prefix > word start > substring > subsequence > none", () => {
  const p = score("mem", "Memory"), w = score("mem", "Go to memory"), s = score("emo", "Memory"), q = score("mmy", "Memory");
  assert.ok(p > w && w > s && s > q && q > 0, `${p} ${w} ${s} ${q}`);
  assert.equal(score("xyz", "Memory"), 0);
});

test("case and diacritic insensitive", () => {
  assert.equal(fold("Õhtu Café"), "ohtu cafe");
  assert.ok(score("CAFE", "café notes") >= 4);
  assert.ok(score("öh", "Ohtu") >= 4);
});

test("word start found even after an in-word occurrence", () => {
  assert.ok(score("art", "smart art") >= 3 && score("art", "smart art") < 4);
});

test("empty query matches everything", () => {
  assert.ok(score("", "anything") > 0);
});

test("rank orders by score, stable, uses keywords", () => {
  const items = [{ label: "Studio clips" }, { label: "CORE" }, { label: "Clips" }, { label: "THEATER", keywords: "cinema watch" }];
  assert.deepEqual(rank("clips", items).map((x) => x.label), ["Clips", "Studio clips"]);
  assert.deepEqual(rank("cinema", items).map((x) => x.label), ["THEATER"]);
  assert.equal(rank("", items).length, 4);
});

test("pushRecent dedupes by id, newest first, and caps", () => {
  const r = (id: string) => ({ id, label: id.toUpperCase() });
  assert.deepEqual(pushRecent([r("a"), r("b"), r("c")], { id: "b", label: "B2" }).map((x) => x.label), ["B2", "A", "C"]);
  assert.equal(pushRecent(Array.from({ length: 8 }, (_, i) => r(String(i))), r("x")).length, 8);
});

test("parseRecent reads objects, upgrades old bare ids, drops junk", () => {
  const labels: Record<string, string> = { "go:core": "CORE" };
  const raw = JSON.stringify(["go:core", "go:gone", { id: "mem:1", label: "Note", hint: "MEMORY" }, { id: "x" }, 5, null]);
  assert.deepEqual(parseRecent(raw, (id) => labels[id]), [{ id: "go:core", label: "CORE" }, { id: "mem:1", label: "Note", hint: "MEMORY" }]);
  assert.deepEqual(parseRecent("not json", () => "x"), []);
  assert.deepEqual(parseRecent(null, () => "x"), []);
  assert.deepEqual(parseRecent('{"a":1}', () => "x"), []);
});

test("multi-word queries match words in any order, below whole-query tiers", () => {
  const s = score("clips studio", "STUDIO · Clips");
  assert.ok(s > 0 && s < 1, String(s));
  assert.equal(score("clips arch", "STUDIO · Clips"), 0);
  assert.ok(score("studio clips", "STUDIO · Clips") >= 1); // in order: still a subsequence
});

test("recent ids win ties without jumping a tier", () => {
  const items = [{ id: "a", label: "Clips one" }, { id: "b", label: "Clips two" }, { id: "c", label: "My clips" }];
  assert.deepEqual(rank("clips", items, ["b"]).map((x) => x.id), ["b", "a", "c"]);
  assert.deepEqual(rank("clips", items, ["c"]).map((x) => x.id), ["a", "b", "c"]); // word start + boost < prefix
});

test("prospectRows: businesses and their contact people, junk skipped", () => {
  const body = { prospects: [{ id: "p1", name: "Kohvik", contact: " Mari Tamm ", stage: "lead" }, { id: "p2", name: "Pood", contact: "" }, { id: 3, name: "x" }, null] };
  assert.deepEqual(prospectRows(body), {
    prospects: [{ id: "p1", label: "Kohvik", hint: "BUSINESS · lead" }, { id: "p2", label: "Pood", hint: "BUSINESS" }],
    people: [{ id: "p1", label: "Mari Tamm", hint: "Kohvik" }],
  });
  assert.deepEqual(prospectRows({ error: "x" }), { prospects: [], people: [] });
  assert.deepEqual(prospectRows(null), { prospects: [], people: [] });
});

test("rowsOf accepts array or wrapped bodies, skips junk", () => {
  assert.deepEqual(rowsOf({ results: [{ id: "1", title: "A" }, { id: 2, title: "" }, null, { id: 3, name: "B" }] }), [{ id: "1", title: "A" }, { id: "3", title: "B" }]);
  assert.deepEqual(rowsOf([{ path: "x/y.txt" }]), [{ id: "x/y.txt", title: "x/y.txt" }]);
  assert.deepEqual(rowsOf({ error: "no" }), []);
  assert.equal(rowsOf({ files: Array.from({ length: 10 }, (_, i) => ({ id: i, title: "t" })) }).length, 6);
});

test("rowsOf reads VAULT file rows by name", async () => {
  const { rowsOf } = await import("../src/lib/palette-pure.ts");
  assert.deepEqual(rowsOf({ files: [{ name: "taxes.pdf", size: 1 }] }), [{ id: "taxes.pdf", title: "taxes.pdf" }]);
});
