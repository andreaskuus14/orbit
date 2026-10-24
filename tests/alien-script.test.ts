import { test } from "node:test";
import assert from "node:assert/strict";
import { codeOf, encode, glyphPath, idGlyphs, linePath, SCRIPT_GLSL, scriptSvg, strokes } from "../src/lib/alien-script-pure.ts";

test("every letter and digit has its own glyph; case folds; spaces are gaps", () => {
  const codes = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", codeOf);
  assert.equal(new Set(codes).size, 36);
  for (const c of codes) assert.ok(c >= 0 && c < 4096);
  assert.equal(codeOf("m"), codeOf("M"));
  assert.deepEqual(encode("GAME DEV")[4], -1);
  assert.deepEqual(encode("MEMORY"), encode("MEMORY"));
});

test("one writing system: every glyph is a broken circle with a seal dot, an outer tick and an inner mark", () => {
  for (let c = 0; c < 4096; c++) {
    const s = strokes(c);
    assert.equal(s[0].k, "arc");
    if (s[0].k === "arc") assert.ok(s[0].a1 - s[0].a0 >= 12 && s[0].a1 - s[0].a0 <= 14); // never a closed O
    assert.equal(s[1].k, "dot");
    assert.equal(s[2].k, "line");
    assert.ok(s.length >= 4 && s.length <= 7, `glyph ${c} has ${s.length} strokes`); // never an empty bowl (a Latin C)
    for (const x of s) for (const v of Object.values(x)) if (typeof v === "number") assert.ok(Number.isFinite(v));
  }
});

test("deterministic, stable ids, finite SVG", () => {
  assert.deepEqual(idGlyphs("core", 5), idGlyphs("core", 5));
  assert.notDeepEqual(idGlyphs("core", 5), idGlyphs("memory", 5));
  assert.equal(idGlyphs("x", 0).length, 0);
  assert.equal(glyphPath(-1), "");
  const p = glyphPath(codeOf("A"), 10, 10, 4);
  assert.match(p, /^M/);
  assert.ok(!/NaN|Infinity/.test(p));
  const l = linePath(encode("AB C"), 2);
  assert.ok(l.w > 0 && l.h > 0);
  assert.ok(scriptSvg("CORE").startsWith("<svg aria-hidden"));
});

test("the GLSL twin mirrors the bit layout", () => {
  for (const s of ["c & 15", "(c >> 4) & 1", "(c >> 5) & 7", "(c >> 8) & 3", "(c >> 10) & 1", "(c >> 11) & 1", "float glyphSdf(vec2 p, int c)"]) assert.ok(SCRIPT_GLSL.includes(s), s);
  assert.ok(!/NaN|undefined/.test(SCRIPT_GLSL));
});
