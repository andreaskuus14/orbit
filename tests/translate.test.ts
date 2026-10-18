import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, cleanTitle, looksEnglish, lruGet, lruSet, parseTranslations, translatePrompt } from "../src/lib/translate-pure.ts";

test("English headlines are skipped, others go to translation", () => {
  assert.ok(looksEnglish("Fire breaks out at the port of Tallinn - ERR News"));
  assert.ok(looksEnglish("Biden says talks will continue"));
  assert.ok(looksEnglish("2024"));
  assert.ok(!looksEnglish("Tallinnas puhkes tulekahju sadamas - ERR"));
  assert.ok(!looksEnglish("Правительство утвердило бюджет"));
  assert.ok(!looksEnglish("東京で大雨警報"));
  assert.ok(!looksEnglish("Le gouvernement présente son budget pour l'année"));
  assert.ok(!looksEnglish("Die Regierung plant neue Steuern in Berlin"));
  assert.ok(!looksEnglish("El gobierno aprueba la reforma de pensiones"));
});

test("cache key is sha1 of the title; LRU keeps the newest within bounds", () => {
  assert.equal(cacheKey("abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
  const m = new Map<string, string>();
  for (let i = 0; i < 5; i++) lruSet(m, `k${i}`, `v${i}`, 3);
  assert.deepEqual([...m.keys()], ["k2", "k3", "k4"]);
  assert.equal(lruGet(m, "k2"), "v2"); // touched → newest
  lruSet(m, "k5", "v5", 3);
  assert.deepEqual([...m.keys()], ["k4", "k2", "k5"]);
  lruSet(m, "k4", "again", 3); // re-set doesn't grow
  assert.equal(m.size, 3);
});

test("model reply parsing: good, partial, malformed", () => {
  const orig = ["Üks", "Kaks", "Kolm"];
  const good = parseTranslations('Here: [{"i":0,"t":"One"},{"i":1,"t":"Two <b>"},{"i":2,"t":"Three"}]', orig);
  assert.deepEqual(good.titles, ["One", "Two b", "Three"]);
  assert.deepEqual(good.got, [true, true, true]);
  const partial = parseTranslations('[{"i":1,"t":"Two"},{"i":7,"t":"x"},{"i":"0","t":"y"},{"i":2,"t":""}]', orig);
  assert.deepEqual(partial.titles, ["Üks", "Two", "Kolm"]);
  assert.deepEqual(partial.got, [false, true, false]);
  for (const bad of ["", "sorry, I can't", "[{oops}]", '{"i":0,"t":"One"}']) {
    const r = parseTranslations(bad, orig);
    assert.deepEqual(r.titles, orig);
    assert.ok(r.got.every((g) => !g));
  }
  assert.equal(parseTranslations(`[{"i":0,"t":"${"a".repeat(900)}"}]`, orig).titles[0].length, 300);
});

test("prompt is JSON data with <> stripped", () => {
  assert.equal(translatePrompt(["a <script> b", "c"]), '[{"i":0,"t":"a script b"},{"i":1,"t":"c"}]');
  assert.equal(cleanTitle("  x\n  y "), "x y");
});
