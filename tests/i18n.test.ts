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

test("every English key has an Estonian key and vice versa", () => {
  const missingEt = Object.keys(EN).filter((k) => !(k in ET));
  const missingEn = Object.keys(ET).filter((k) => !(k in EN));
  assert.deepEqual(missingEt, [], `EN keys with no ET: ${missingEt.join(", ")}`);
  assert.deepEqual(missingEn, [], `ET keys with no EN: ${missingEn.join(", ")}`);
});

test("no shouted ALL-CAPS labels (sentence case); acronyms and planet names allowed", () => {
  const ok = /^(planet\.|sys\.title$)/;
  const bad = Object.entries({ ...EN, ...ET } as Record<string, string>).filter(([k, v]) => !ok.test(k) && /[A-ZÕÄÖÜ]{3,} [A-ZÕÄÖÜ]{2,}/.test(v) && v === v.toUpperCase());
  assert.deepEqual(bad.map(([k]) => k), []);
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

// ---- one language per first load (perf/i18n-split) ----
test("Estonian planet names fit the 13-character label width Galaxy reserves", () => {
  for (const p of PLANETS) assert.ok((ET[`planet.${p.id}` as Key] ?? "").length <= 13, p.id);
});

test("browser stand-in translates only from loaded dictionaries, same rules as the server", async () => {
  const b = await import("../src/lib/i18n-browser.ts");
  assert.equal(b.translate("et", "lang.title"), "lang.title"); // nothing loaded yet: the key, never blank
  b.dicts.et = ET;
  assert.equal(b.translate("et", "lang.title"), translate("et", "lang.title"));
  b.dicts.en = EN;
  assert.equal(b.plural("en", "ws.doneSteps", 3), plural("en", "ws.doneSteps", 3));
  assert.equal(b.plural("et", "ws.doneSteps", 1), plural("et", "ws.doneSteps", 1));
  assert.equal("EN" in b || "ET" in b, false, "the browser module must not carry dictionaries");
});

test("language cookie: whole site, one year, readable by the server", async () => {
  const { langCookie, parseLang: p } = await import("../src/lib/i18n-core-pure.ts");
  assert.equal(langCookie("et"), "orbit.lang=et; Path=/; Max-Age=31536000; SameSite=Lax");
  assert.equal(p("et"), "et"); assert.equal(p("xx"), "en"); assert.equal(p(undefined), "en");
});

test("layout serves the dictionary named by the cookie; only next.config swaps i18n-pure for the browser", async () => {
  const { readFileSync } = await import("node:fs");
  const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /cookies\(\)\)\.get\(LANG_KEY\)/);
  assert.match(layout, /<html lang=\{lang\}/);
  assert.match(layout, /<LangBoot lang=\{lang\}>/);
  const hook = readFileSync(new URL("../src/components/i18n.tsx", import.meta.url), "utf8");
  assert.match(hook, /import\("@\/lib\/i18n-et-pure"\)/); // lazy chunks, never a static import
  assert.ok(!/^import [^\n]*i18n-(en|et)-pure/m.test(hook));
  const bootSrc = readFileSync(new URL("../src/components/i18n-boot.tsx", import.meta.url), "utf8");
  assert.ok(!/i18n-(en|et|browser|pure)|from "\.\/i18n"/.test(bootSrc), "layout boot must not pull a dictionary into every page");
  const cfg = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(cfg, /if \(!isServer\)[^\n]*i18n-browser/);
});
