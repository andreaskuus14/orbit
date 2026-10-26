import { test } from "node:test";
import assert from "node:assert/strict";
import { coach, slabCheck, smallest, timberCheck } from "../src/lib/arch-structure-pure.ts";
import { starterScene } from "../src/lib/arch-pure.ts";

const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} vs ${b}`);
const num = (line: string, re: RegExp) => Number(re.exec(line)![1].replace(/,/g, ""));

/* Hand calc, timber joist 45×220 C24, span 4.0 m, spacing 400 mm, residential:
   self-weight = 420 × 9.81 × 0.045 × 0.220 / 1000 = 0.0408 kN/m
   G = 0.5 × 0.4 + 0.0408 = 0.2408 kN/m,  Q = 1.5 × 0.4 = 0.600 kN/m
   q_d = 1.35 × 0.2408 + 1.5 × 0.6 = 1.2251 kN/m,  M = 1.2251 × 4² / 8 = 2.450 kNm
   W = 45 × 220² / 6 = 363 000 mm³,  σ = 2.450e6 / 363 000 = 6.75 N/mm²
   f_m,d = 0.8 × 24 / 1.3 = 14.77 N/mm² (h ≥ 150 so k_h = 1)  → 46 % used
   I = 45 × 220³ / 12 = 39.93e6 mm⁴,  384·E·I = 384 × 11 000 × 39.93e6 = 1.6866e14
   w_G = 5 × 0.2408 × 4000⁴ / 1.6866e14 = 1.83 mm,  w_Q = 5 × 0.6 × 4000⁴ / 1.6866e14 = 4.55 mm
   w_fin = 1.83 × 1.6 + 4.55 × (1 + 0.3 × 0.6) = 2.92 + 5.37 = 8.30 mm ≤ 4000/300 = 13.33 → 62 % used */
test("timber joist 45×220 over 4 m matches the hand calc", () => {
  const c = timberCheck(4, 0.4, 45, 220);
  assert.equal(c.ok, true);
  near(num(c.steps.find((s) => s.startsWith("  σ"))!, /= ([\d.]+) N\/mm²$/), 6.75);
  near(num(c.steps.find((s) => s.includes("M = q_d"))!, /= ([\d.]+) kNm/), 2.45);
  near(num(c.steps.find((s) => s.includes("w_fin"))!, /= ([\d.]+) mm$/), 8.3);
  near(c.util, 8.3 / 13.333);
});

/* Hand calc, which section is smallest for 4.0 m @ 400 mm (deflection governs, not bending):
   45×170: I = 45 × 170³ / 12 = 18.42e6 → w_fin ≈ 8.30 × 39.93/18.42 ≈ 17.7 mm > 13.33 FAIL
   70×145: I = 70 × 145³ / 12 = 17.78e6 → ≈ 18.6 mm FAIL (smaller areas fail harder)
   45×195: I = 45 × 195³ / 12 = 27.81e6 → ≈ 11.8 mm ≤ 13.33 PASS; area 8 775 mm² is the first that passes. */
test("smallest C24 joist for 4 m at 400 mm is 45×195; deflection governs", () => {
  assert.equal(smallest("timber", 4, 0.4)!.size, "45×195 mm C24 @ 400 mm");
  const t = timberCheck(4, 0.4, 45, 170);
  assert.equal(t.ok, false);
  assert.ok(t.steps.some((s) => s.includes("deflection FAILS")) && t.steps.some((s) => s.includes("bending OK")));
});

/* Hand calc, k_h for a shallow joist: h = 120 < 150 → k_h = (150/120)^0.2 = 1.0456, f_m,d = 1.0456 × 14.77 = 15.44 N/mm². */
test("depth factor k_h raises strength of shallow joists", () => {
  near(num(timberCheck(3, 0.4, 45, 120).steps.find((s) => s.includes("f_m,d"))!, /= ([\d.]+) N\/mm²$/), 15.44);
});

/* Hand calc, RC slab 200 mm C25/30, span 4.0 m, d = 170 mm, per metre:
   G = 25 × 0.2 + 1.0 = 6.0 kN/m², Q = 1.5;  q_d = 1.35 × 6 + 1.5 × 1.5 = 10.35;  M = 10.35 × 16 / 8 = 20.7 kNm/m
   K = 20.7e6 / (1000 × 170² × 25) = 0.0287 ≤ 0.167;  z = 170 × (0.5 + √(0.25 − 0.0287/1.134)) = 165.6 → cap 0.95d = 161.5
   A_s = 20.7e6 / (434.8 × 161.5) = 295 mm²/m (min 0.26 × 2.6/500 × 1000 × 170 = 230)
   ρ = 295 / 170 000 = 0.173 %, ρ0 = 0.5 %:  L/d_lim = 11 + 1.5×5×2.88 + 3.2×5×1.88^1.5 = 11 + 21.6 + 41.3 = 74.0
   L/d = 4000 / 170 = 23.5 → OK (32 % used) */
test("RC slab 200 mm over 4 m matches the hand calc", () => {
  const c = slabCheck(4, 200);
  assert.equal(c.ok, true);
  near(num(c.steps.find((s) => s.includes("K = M"))!, /= ([\d.]+) ≤/), 0.0287, 0.02);
  near(num(c.steps.find((s) => s.includes("A_s = M"))!, /= ([\d,]+) mm²\/m \(min/), 295);
  near(num(c.steps.find((s) => s.includes("allowed L/d"))!, /allowed L\/d = ([\d.]+)/), 74, 0.01);
  near(c.util, 23.53 / 74, 0.02);
});

/* Hand calc, smallest slab for 4.0 m:
   120 mm, d = 90: q_d = 1.35 × 4 + 2.25 = 7.65, M = 15.3, K = 0.0756, z = 83.5, A_s = 421, ρ = 0.468 %
     L/d_lim = 11 + 1.5×5×1.068 + 16×0.068^1.5 = 19.3 < 44.4 FAIL
   150 mm, d = 120: q_d = 8.66, M = 17.33, K = 0.0481, z = 114 (cap), A_s = 350, ρ = 0.291 %
     L/d_lim = 11 + 7.5×1.717 + 16×0.717^1.5 = 11 + 12.9 + 9.7 = 33.6 ≥ 33.3 PASS (just) */
test("smallest RC slab for 4 m is 150 mm; 120 mm fails span/depth", () => {
  assert.equal(smallest("concrete", 4, 1)!.h, 150);
  assert.equal(slabCheck(4, 120).ok, false);
  assert.equal(smallest("concrete", 12, 1), null); // nothing standard spans 12 m
});

test("coach checks only slabs standing on walls, and flags a thin one", () => {
  const s = starterScene();
  assert.deepEqual(coach(s.parts, "timber", 0.4), []); // the ground slab rests on the ground
  const upper = { id: "u", kind: "slab" as const, name: "Floor 2", x: 0, y: 3, z: 0, w: 10, d: 4.3, h: 0.17 }; // span 4.3 − 0.3 = 4.0 m
  const [r] = coach([...s.parts, upper], "timber", 0.4);
  near(r.span, 4);
  assert.equal(r.now.ok, false); // 45×170 fails deflection
  assert.equal(r.best!.h, 195);
});

/* 10×8 house, upper floor slab 200 mm. Shell walls 300 mm: centre lines 8 − 0.3 = 7.7 m apart across the short side.
   No inner wall: span 7.7 m → 200 mm RC fails span/depth (L/d = 7700/170 = 45 > ~33); no C24 joist passes either.
   A full-width wall along x at z = 0 (9.4 m long, between the shell walls) splits it: gaps 3.85 + 3.85 → span 3.85 m.
   200 mm RC: L/d = 3850/170 = 22.6 → OK; timber 45×200 over 3.85 m (45×195 already passes 4 m) → OK. */
test("an interior wall under the slab splits the span: a 10×8 house with a central wall passes", () => {
  const s = starterScene(); // walls y 0.2 h 2.8 → top 3.0
  const upper = { id: "u", kind: "slab" as const, name: "Floor 2", x: 0, y: 3, z: 0, w: 10, d: 8, h: 0.2 };
  const mid = { id: "m", kind: "wall" as const, name: "Central wall", x: 0, y: 0.2, z: 0, w: 9.4, d: 0.2, h: 2.8 };
  const [open] = coach([...s.parts, upper], "concrete", 1);
  near(open.span, 7.7);
  assert.equal(open.now.ok, false);
  assert.equal(coach([...s.parts, upper], "timber", 0.4)[0].now.ok, false);
  for (const type of ["concrete", "timber"] as const) {
    const [r] = coach([...s.parts, upper, mid], type, 0.4);
    near(r.span, 3.85);
    assert.deepEqual(r.walls.map((w) => w.id), ["m"]);
    assert.equal(r.now.ok, true, `${type} passes with the central wall`);
  }
  // a wall that stops short (needs a beam), or one not reaching the slab, is not a support
  const short = { ...mid, w: 5 }, low = { ...mid, h: 2.4 };
  for (const w of [short, low]) near(coach([...s.parts, upper, w], "concrete", 1)[0].span, 7.7);
  // a wall along z at x = 1 splits the 10 m way into 5.85 + 3.85: the 7.7 m short way still governs
  near(coach([...s.parts, upper, { ...mid, x: 1, z: 0, w: 0.2, d: 7.4 }], "concrete", 1)[0].span, 5.85);
});
