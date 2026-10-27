import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, boq, starterScene } from "../src/lib/arch-pure.ts";
import { loadLab, MATERIALS, parsePrice, perM2, priceChanges, schemeTotals, SEED_SCHEMES, uValue } from "../src/lib/arch-materials-pure.ts";

const A = SEED_SCHEMES[0];

test("boq gives the areas the lab prices", () => {
  const q = boq(starterScene().parts);
  assert.equal(q.wallM2, 97.44); // (2×(10+8) − 4×0.3) × 2.8
  assert.equal(q.slabM2, 80); // 10 × 8
  assert.equal(q.roofM2, 113.85); // 11 × 9 × 1.15
  assert.equal(q.windowM2, 0);
  const w = boq(applyOps(starterScene(), [{ op: "add", kind: "window", host: "p3", face: "s", w: 1.2 }], () => "x").scene.parts);
  assert.deepEqual([w.windowM2, w.wallM2], [1.44, 96]);
});

test("U-value by hand: 1 / (Rsi + Σ t/λ + Rse); cladding adds nothing", () => {
  // wall: 0.13 + 0.3/0.10 + 0.15/0.035 + 0.04 = 7.4557 → 0.134
  assert.equal(uValue(A.wall, "wall", MATERIALS), 0.134);
  // slab (downward, Rsi 0.17): 0.17 + 0.1/2.3 + 0.25/0.036 + 0.04 = 7.1979 → 0.139
  assert.equal(uValue(A.slab, "slab", MATERIALS), 0.139);
  assert.equal(uValue([{ mat: "clad", t: 0 }], "wall", MATERIALS), null);
});

test("cost and carbon per m² by hand", () => {
  // AAC 0.3 × 125 + wool 0.15 × 50 + cladding 14 = 59 €/m²; 0.3 × 112 + 0.15 × 38.4 + 2.95 = 42.31 kgCO2e/m²
  assert.deepEqual(perM2(A.wall, MATERIALS), { eur: 59, co2: 42.31 });
  const frame = MATERIALS.find((m) => m.id === "frame")!;
  assert.equal(frame.lambda, 0.04925); // 0.15 × 0.13 + 0.85 × 0.035
  assert.equal(frame.co2, 52.76); // 0.15 × 134.13 + 0.85 × 38.4
  assert.equal(MATERIALS.find((m) => m.id === "concrete")!.co2, 256.8); // ICE v3 0.107 × 2400
});

test("scheme totals on the starter house, with one window", () => {
  const q = boq(applyOps(starterScene(), [{ op: "add", kind: "window", host: "p3", face: "s", w: 1.2 }], () => "x").scene.parts);
  const t = schemeTotals(A, q, MATERIALS), row = (s: string) => t.rows.find((r) => r.slot === s)!;
  assert.deepEqual([row("wall").cost, row("wall").co2], [5664, 4062]); // 96 × 59, 96 × 42.31
  assert.deepEqual([row("slab").cost, row("slab").co2], [2180, 3370]); // 80 × 27.25, 80 × 42.13
  assert.deepEqual([row("window").cost, row("window").co2, row("window").u], [353, 62, 0.8]); // 1.44 × 245, 1.44 × 43.2
  assert.equal(t.cost, t.rows.reduce((a, r) => a + r.cost, 0));
  assert.ok(row("wall").u! <= row("wall").target);
});

test("parsePrice reads JSON-LD, Estonian and euro-first formats", () => {
  assert.equal(parsePrice('<script type="application/ld+json">{"@type":"Offer","price":"12.90","priceCurrency":"EUR"}</script>'), 12.9);
  assert.equal(parsePrice("<span>Hind 1 234,50 €</span>"), 1234.5);
  assert.equal(parsePrice("<b>€ 4,49</b>"), 4.49);
  assert.equal(parsePrice("<p>call for price</p>"), null);
});

test("priceChanges divides by what one listed price buys, and only reports real changes", () => {
  const mats = MATERIALS.map((m) => (m.id === "aac" ? { ...m, url: "https://shop.example/aac" } : m));
  assert.deepEqual(priceChanges(mats, [{ id: "aac", price: 4.5 }]), []); // 4.5 / 0.036 = 125, unchanged
  assert.deepEqual(priceChanges(mats, [{ id: "aac", price: 4.68 }, { id: "eps", price: 70 }]).map((c) => [c.id, c.old, c.next]), [["aac", 125, 130]]); // eps has no url
});

test("loadLab keeps his prices and schemes, never his thermal or carbon data, and survives junk", () => {
  assert.deepEqual(loadLab("junk").schemes, SEED_SCHEMES);
  const l = loadLab({ mats: [{ id: "eps", eur: 70, priceSource: "x", priceDate: "2026-11-01", lambda: 0.001, co2: 0 }], schemes: [{ name: "Mine", wall: [{ mat: "nope", t: 1 }], slab: A.slab, roof: A.roof, window: "glass2" }] });
  const eps = l.mats.find((m) => m.id === "eps")!;
  assert.deepEqual([eps.eur, eps.lambda, eps.co2], [70, 0.036, 65.8]);
  assert.equal(l.schemes[0].name, "Mine");
  assert.deepEqual(l.schemes[0].wall, A.wall); // unknown material → seed
  assert.equal(l.schemes[0].window, "glass2");
});
