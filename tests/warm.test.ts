import { test } from "node:test";
import assert from "node:assert/strict";
import { passesChanged, programLabel, skipFrame, slowest } from "../src/lib/warm-pure.ts";

test("a composer warms on its first frame and again only when its passes change", () => {
  const a = {}, b = {}, c = {};
  assert.equal(passesChanged(undefined, [a, b]), true);
  const w = { passes: [a, b], ready: true, until: 0 };
  assert.equal(passesChanged(w, [a, b]), false);
  assert.equal(passesChanged(w, [a, c]), true); // a pass rebuilt (e.g. an effect toggled)
  assert.equal(passesChanged(w, [a]), true);
  assert.equal(passesChanged(w, [a, b, c]), true);
});

test("frames are skipped only while compiling and before the deadline", () => {
  assert.equal(skipFrame({ passes: [], ready: false, until: 2000 }, 1000), true);
  assert.equal(skipFrame({ passes: [], ready: false, until: 2000 }, 2000), false); // stuck: draw anyway
  assert.equal(skipFrame({ passes: [], ready: true, until: 2000 }, 1000), false);
});

test("slowest: the n longest compiles, slowest first, input untouched", () => {
  const l = [{ ms: 10 }, { ms: 300 }, { ms: 50 }, { ms: 900 }];
  assert.deepEqual(slowest(l, 2), [{ ms: 900 }, { ms: 300 }]);
  assert.deepEqual(l.map((x) => x.ms), [10, 300, 50, 900]);
  assert.deepEqual(slowest([], 3), []);
});

test("programLabel: name, three's shader id, ORBIT variant defines, first custom uniforms", () => {
  assert.equal(programLabel("BokehMaterial", "35,49,PASS,1", ""), "BokehMaterial");
  assert.equal(programLabel("", "physical,STANDARD,,PHYSICAL,,ORBIT_LITE,,ORBIT_BARE,highp", "uniform float uRim; uniform vec3 uRimColor;\nuniform float uLq; uniform float uRim; uniform vec3 uTint;"),
    "physical+ORBIT_LITE+ORBIT_BARE(uRim,uRimColor,uLq)");
  assert.equal(programLabel("", "4,5,highp,srgb-linear", "uniform vec3 uCam; uniform mat4 uMVP;"), "shader(uCam,uMVP)");
  assert.equal(programLabel("", "basic,highp", "uniform vec3 diffuse;"), "basic");
  assert.equal(programLabel("", "physical,STANDARD,,highp", ""), "standard");
});
