import { test } from "node:test";
import assert from "node:assert/strict";
import { CORE_LANG_RULE, EN, ET, greetKey, parseLang, plural, translate, type Key } from "../src/lib/i18n-pure.ts";
import { PLANETS } from "../src/lib/planets.ts";

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every Estonian key exists in English, with the same placeholders", () => {
  for (const [k, v] of Object.entries(ET)) {
    assert.ok(k in EN, `ET key missing in EN: ${k}`);
    assert.deepEqual(vars(v!), vars(EN[k as Key]), `placeholders differ: ${k}`);
    assert.ok(v!.trim(), `empty ET string: ${k}`);
  }
});

test("every planet has an English and an Estonian name and blurb", () => {
  for (const p of PLANETS) {
    assert.equal(EN[`planet.${p.id}`], p.name);
    assert.ok(ET[`planet.${p.id}`] && ET[`planet.${p.id}.blurb`], p.id);
  }
});

test("lookup falls back to English, then to the key", () => {
  assert.equal(translate("et", "common.approve"), "Kinnita");
  assert.equal(translate("en", "common.approve"), "Approve");
  const etMissing = (Object.keys(EN) as Key[]).find((k) => !ET[k]);
  if (etMissing) assert.equal(translate("et", etMissing), EN[etMissing]);
  assert.equal(translate("et", "nope.key" as Key), "nope.key");
  assert.equal(translate("et", "remote.waiting", { n: 3 }), "Ootab sind (3)");
  assert.equal(translate("en", "menu.sounds"), "UI sounds: {state}"); // unknown placeholders stay visible, not blanked
});

test("plural: singular only for exactly one; Estonian partitive otherwise", () => {
  assert.equal(plural("et", "since.notes", 1), "1 uus teavitus");
  assert.equal(plural("et", "since.notes", 2), "2 uut teavitust");
  assert.equal(plural("et", "since.notes", 21), "21 uut teavitust");
  assert.equal(plural("et", "since.notes", 0), "0 uut teavitust");
  assert.equal(plural("en", "since.notes", 1), "1 new notification");
  assert.equal(plural("en", "remote.approveCredits", 5), "Approve 5 credits");
});

test("parseLang, greetings and the CORE rule", () => {
  assert.equal(parseLang("et"), "et");
  assert.equal(parseLang("de"), "en");
  assert.equal(parseLang(null), "en");
  assert.equal(greetKey(7), "greet.morning");
  assert.equal(greetKey(12), "greet.afternoon");
  assert.equal(greetKey(18), "greet.evening");
  assert.equal(CORE_LANG_RULE.en, "");
  assert.match(CORE_LANG_RULE.et, /Estonian/);
});
