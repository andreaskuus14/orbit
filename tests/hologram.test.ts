import { test } from "node:test";
import assert from "node:assert/strict";
import { compactNumber, holoLine, scrambleStep } from "../src/lib/hologram-pure.ts";

test("compactNumber formats like 12.4K and never prints NaN", () => {
  assert.equal(compactNumber(12_400), "12.4K");
  assert.equal(compactNumber(950), "950");
  assert.equal(compactNumber(1_250_000), "1.3M");
  assert.equal(compactNumber(NaN), "0");
  assert.equal(compactNumber(Infinity), "0");
});

test("scrambleStep scrambles, keeps length, then settles", () => {
  const mid = scrambleStep("12.4K SUBS", 100, 400, 7);
  assert.equal(mid.length, "12.4K SUBS".length);
  assert.notEqual(mid, "12.4K SUBS");
  assert.equal(mid[2], "."); assert.equal(mid[5], " "); // punctuation stays put
  assert.equal(scrambleStep("12.4K SUBS", 400), "12.4K SUBS");
  assert.equal(scrambleStep("12.4K SUBS", 999), "12.4K SUBS");
  assert.equal(scrambleStep("12.4K SUBS", 0, 400, 1, true), "12.4K SUBS");
  assert.equal(scrambleStep("x", NaN), "x");
  assert.equal(scrambleStep("abc", 10, 400, 3), scrambleStep("abc", 10, 400, 3)); // deterministic per seed
});

test("holoLine collapses whitespace and clips", () => {
  assert.equal(holoLine("  a \n b  "), "a b");
  assert.equal(holoLine("abcdef", 4), "abc…");
});
