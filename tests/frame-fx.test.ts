import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { FX, GRADE, WORLD_GRADE, decodeEmissive, decodeWater, emissiveGain, fxOn, fxUrl, gradeOk, hasFx, phases, stormsFrom, swirlAngle, wind } from "../src/lib/frame-fx-pure.ts";
import { FRAME_IDS } from "../src/lib/frame-scene-pure.ts";
import { PAINTED_STORMS } from "../src/lib/frame-map-pure.ts";

test("effects are off under reduced motion and on tier 0, on otherwise", () => {
  assert.equal(fxOn({ reduced: true }), false); assert.equal(fxOn({ reduced: false, tier: 0 }), false);
  assert.equal(fxOn({ reduced: false, tier: 2 }), true); assert.equal(fxOn({ reduced: false }), true);
});
test("water mask: high values flow, low values ripple, zero is dry", () => {
  assert.ok(decodeWater(0.9).flow > 0.8); assert.equal(decodeWater(0.9).ripple, 0);
  assert.ok(decodeWater(0.3).ripple > 0.9); assert.equal(decodeWater(0.3).flow, 0);
  assert.deepEqual(decodeWater(0), { flow: 0, ripple: 0 });
});
test("emissive channel round-trips the 0.25 + 0.75 v encoding and clamps", () => {
  assert.equal(decodeEmissive(0.25), 0); assert.equal(decodeEmissive(1), 1); assert.ok(Math.abs(decodeEmissive(0.625) - 0.5) < 1e-9); assert.equal(decodeEmissive(0), 0);
});
test("wind: tips move, rooted bases do not, near plants move more, the gust is bounded", () => {
  assert.equal(wind(3, 0.4, 0.4, 0, 0.5, 0.003), 0);
  let max = 0, near = 0, far = 0;
  for (let t = 0; t < 60; t += 0.1) { max = Math.max(max, Math.abs(wind(t, 0.4, 0.4, 1, 0.5, 0.003))); near = Math.max(near, Math.abs(wind(t, 0.4, 0.4, 1, 1, 0.003))); far = Math.max(far, Math.abs(wind(t, 0.4, 0.4, 1, 0, 0.003))); }
  assert.ok(max > 0.001 && max < 0.005); assert.ok(near > far);
});
test("swirl phases crossfade so the picture never winds up", () => {
  for (let t = 0; t < 100; t += 0.7) { const p = phases(t); assert.ok(p.wa >= 0 && p.wa <= 1); assert.ok(p.a >= 0 && p.a < 1 && p.b >= 0 && p.b < 1); }
  assert.equal(phases(0).wa, 0); assert.ok(Math.abs(phases(12).wa - 1) < 1e-9);
  assert.ok(swirlAngle(0, 1, 1) > swirlAngle(0.6, 1, 1)); assert.equal(swirlAngle(1, 1, 1), 0); assert.equal(swirlAngle(0, 0, 1), 0);
  assert.ok(swirlAngle(0, 1, 1) < 2); // at most about a turn of a radian or so per period: slow
});
test("lamps flicker within bounds and only where the mask is emissive", () => {
  const p = { flicker: 0.2, shimmer: 0.5 };
  assert.equal(emissiveGain(1.3, 0, 0.4, 0.5, p), 1);
  for (let t = 0; t < 30; t += 0.13) { const g = emissiveGain(t, 1, 0.7, 0.3, p); assert.ok(g > 0.75 && g < 1.5); }
});
test("per plate settings: only plates with masks, strengths are subtle, rotors sit inside the frame", () => {
  for (const id of Object.keys(FX)) {
    assert.ok(FRAME_IDS.includes(id as never)); const f = FX[id as keyof typeof FX]!;
    assert.ok(f.sway <= 0.005 && f.drift <= 0.012 && f.flicker <= 0.3 && f.rotors.length <= 3);
    for (const r of f.rotors) { assert.ok(r.x - r.r / 1.78 > 0 && r.x + r.r / 1.78 < 1 && r.y - r.r > 0 && r.y + r.r < 1); assert.ok(r.rate > 0 && r.rate < 2); }
    assert.ok(statSync(`public${fxUrl(id)}`).size > 500 && statSync(`public${fxUrl(id)}`).size < 200_000);
  }
  for (const id of ["life", "gamedev", "memory", "arch"]) assert.ok(hasFx(id));
});
test("calm grade: every plate has one, the loudest ones are cut 20 to 30 percent and none is boosted", () => {
  for (const id of FRAME_IDS) assert.ok(gradeOk(GRADE[id]), id);
  for (const id of ["business", "gamedev", "memory", "studio", "life"] as const) assert.ok(GRADE[id].sat >= 0.65 && GRADE[id].sat <= 0.8, id);
  assert.equal(GRADE.analytics.sat >= 0.9, true); // the reference look stays
});
test("world storms come from the painted cyclones, in 0..1, turning opposite ways north and south", () => {
  const s = stormsFrom(PAINTED_STORMS); assert.equal(s.length, PAINTED_STORMS.length);
  for (const x of s) { assert.ok(x.x > 0 && x.x < 1 && x.y > 0 && x.y < 1 && x.r > 0.05 && x.r < 0.2 && x.period > 10); }
  assert.ok(s.some((x) => x.dir === 1) && s.some((x) => x.dir === -1));
  assert.ok(WORLD_GRADE.sat < 1 && WORLD_GRADE.tint > 0);
});
test("the shader and the plate loader use the pure module", () => {
  const sc = readFileSync("src/components/FrameScene.tsx", "utf8"), gl = readFileSync("src/components/intel/plate-gl.ts", "utf8"), fm = readFileSync("src/components/intel/FrameMap.tsx", "utf8");
  assert.ok(sc.includes("fxOn({ reduced })") && sc.includes("GRADE[id]") && sc.includes("uRotA")); assert.ok(gl.includes("uniform vec4 st[3]") && fm.includes("stormsFrom(PAINTED_STORMS)"));
});

import { townLinks, type TownNews } from "../src/lib/earth-pure.ts";
test("town arcs join only towns that share a story, biggest overlap first", () => {
  const T = (name: string, titles: string[]): TownNews => ({ name, lon: 24, lat: 59, kind: "town", count: titles.length, stories: titles.map((title) => ({ title, url: "", weak: false }) as never) });
  const a = T("A", ["x", "y"]), b = T("B", ["y", "z"]), c = T("C", ["q"]), d = T("D", ["x", "y"]);
  const l = townLinks([a, b, c, d]);
  assert.ok(l.every(([p, q]) => p.name !== "C" && q.name !== "C"));
  assert.equal(l[0][0].name + l[0][1].name, "AD"); assert.equal(townLinks([c], 6).length, 0); assert.ok(townLinks([a, b, d], 1).length === 1);
});
test("ARCH shows the plate through the ground: shadow-only ground, no cosmetic trees or grid on the plate", () => {
  const s = readFileSync("src/components/ArchWorld.tsx", "utf8");
  assert.ok(s.includes("plateOn ? <shadowMaterial") && s.includes("!plateOn && <gridHelper") && s.includes("!ifc && !plateOn && <Trees"));
});

import { DATA_FLOOR, MOBILE_LABEL_MAX_Y, ZOOM_FX, dataGlow, labelClear } from "../src/lib/frame-fx-pure.ts";
test("every planet has a mask and a param set; zoom plates have their own generic mask", () => {
  for (const id of ["vault", "operations", "business", "agents", "memory", "analytics", "studio", "life", "gamedev", "arch", "core"]) { assert.ok(hasFx(id), id); assert.ok(statSync(`public${fxUrl(id)}`).size > 500, id); }
  for (const id of ZOOM_FX) assert.ok(statSync(`public${fxUrl(id, true)}`).size > 500, id);
  assert.equal(FX.analytics!.flowDir, -1); // particles rise along the beams
  assert.ok(FX.operations!.rotors.length >= 1 && FX.agents!.rotors.length >= 1 && FX.core!.rotors.length >= 1);
});
test("studio reds are graded down", () => { assert.ok((GRADE.studio.red ?? 0) >= 0.5); assert.ok(GRADE.studio.sat <= 0.75); });
test("glow only on data-carrying items: full near a label slot, the floor elsewhere", () => {
  assert.equal(dataGlow([0.5, 0.5], [[0.5, 0.5]]), 1); assert.equal(dataGlow([0.1, 0.1], [[0.8, 0.8]]), DATA_FLOOR); assert.equal(dataGlow([0.1, 0.1], []), DATA_FLOOR);
  const mid = dataGlow([0.52, 0.5], [[0.5, 0.5]]); assert.ok(mid > DATA_FLOOR && mid < 1);
});
test("mobile labels stay clear of the bottom panel; wide screens are untouched", () => {
  assert.equal(labelClear(0.9, 1280), true); assert.equal(labelClear(0.9, 390), false); assert.equal(labelClear(MOBILE_LABEL_MAX_Y, 390), true); assert.equal(labelClear(0.3, 390), true);
  assert.ok(readFileSync("src/components/FrameScene.tsx", "utf8").includes("labelClear(p[1], size.width)"));
});

import { INTEL_GRADE, LIVE_DIM, LIVE_THIN, linesUrl, plateGrade } from "../src/lib/frame-fx-pure.ts";
test("Intelligence plates are darker and simpler: grade, line masks on disk, live overlays dimmer and thinner", () => {
  assert.ok(INTEL_GRADE.dark >= 0.12 && INTEL_GRADE.dark <= 0.2 && INTEL_GRADE.sat < 1 && INTEL_GRADE.vig > 0.3);
  assert.ok(INTEL_GRADE.lineKnock >= 0.6 && INTEL_GRADE.lineKnock <= 0.7 && INTEL_GRADE.haloKnock > 0 && INTEL_GRADE.haloKnock < INTEL_GRADE.lineKnock);
  for (const id of ["world", "europe", "estonia", "tallinn", "village"]) { assert.ok(statSync(`public${linesUrl(id)}`).size > 200); assert.equal(plateGrade(id).lines, linesUrl(id)); }
  assert.ok(plateGrade("world").sat < plateGrade("europe").sat); assert.equal(plateGrade("europe").sat, INTEL_GRADE.sat);
  assert.ok(Math.abs(1 - LIVE_DIM - 0.3) < 1e-9 && LIVE_THIN < 1);
  const gl = readFileSync("src/components/intel/plate-gl.ts", "utf8"); assert.ok(gl.includes("uniform sampler2D ln") && gl.includes("warm"));
});

test("FrameScene output is sRGB-encoded so plates match their source brightness; loud plates are dimmed a little", () => {
  assert.ok(readFileSync("src/components/FrameScene.tsx", "utf8").includes("linearToOutputTexel(vec4(col, 1.0))"));
  for (const id of ["business", "gamedev", "memory", "studio", "life"] as const) { const d = GRADE[id].dim ?? 1; assert.ok(d >= 0.78 && d <= 0.9, id); }
  for (const id of ["vault", "analytics", "arch"] as const) assert.equal(GRADE[id].dim ?? 1, 1);
});
