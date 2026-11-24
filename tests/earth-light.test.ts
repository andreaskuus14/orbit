import { test } from "node:test";
import assert from "node:assert/strict";
import { dayK, lightsK, duskK, LIGHT_GLSL } from "../src/lib/earth-light-pure.ts";

const s = (deg: number) => Math.sin((deg * Math.PI) / 180);

test("full day at +10° and above, full night at -6° and below", () => {
  assert.equal(dayK(s(10)), 1); assert.equal(dayK(s(40)), 1);
  assert.equal(dayK(s(-6)), 0); assert.equal(dayK(s(-30)), 0);
  assert.equal(lightsK(s(-6)), 1); assert.equal(lightsK(s(5)), 0);
});

test("dusk (-3°) is in between: some daylight, most lights on", () => {
  const d = dayK(s(-3)), l = lightsK(s(-3));
  assert.ok(d > 0.02 && d < 0.3, `day ${d}`);
  assert.ok(l > 0.5 && l < 1, `lights ${l}`);
});

test("smooth terminator: curves are monotonic with no jumps", () => {
  let pd = 0, pl = 1;
  for (let e = -20; e <= 20; e += 0.25) {
    const d = dayK(s(e)), l = lightsK(s(e));
    assert.ok(d >= pd && d - pd < 0.05, `day jump at ${e}`);
    assert.ok(l <= pl && pl - l < 0.08, `lights jump at ${e}`);
    pd = d; pl = l;
  }
});

test("dusk warmth peaks near the horizon and is gone at noon and deep night", () => {
  assert.ok(duskK(s(-1)) > 0.99);
  assert.ok(duskK(s(30)) < 0.01 && duskK(s(-30)) < 0.01);
});

test("the GLSL uses the same numbers", () => {
  assert.match(LIGHT_GLSL, new RegExp(`smoothstep\\(${s(-6).toFixed(5)}, ${s(10).toFixed(5)}, s\\)`));
  assert.match(LIGHT_GLSL, /float lightsK\(float s\)/);
  assert.match(LIGHT_GLSL, /vec3 SODIUM/);
});
