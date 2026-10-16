import { test } from "node:test";
import assert from "node:assert/strict";
import { score, rank, fold, pushRecent, rowsOf } from "../src/lib/palette-pure.ts";

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

test("pushRecent dedupes and caps", () => {
  assert.deepEqual(pushRecent(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.equal(pushRecent(["1", "2", "3", "4", "5", "6"], "7").length, 6);
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
