import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSONAS, scoreAll, type Walkthrough } from "../src/lib/personas-pure.ts";
import { parseExport, type Retention } from "../src/lib/gamedev-retention-pure.ts";
import { adjust, calibrate, cleanFactors, compare, factorFor, predict } from "../src/lib/persona-calibration-pure.ts";

// Fixtures (made up, shaped like a Creator Dashboard export): mature days through 2026-10-20.
const RETENTION_CSV = `Date,New Users,Day 1 Retention,Day 7 Retention,Avg Session Time (min)
2026-10-01,400,24%,6%,9
2026-10-02,600,20%,4%,11
2026-10-18,300,,,10
2026-10-19,200,,,10`;
const FUNNEL_CSV = "Step,Users\nJoined,1000\nFirst egg hatched,500\nBought an upgrade,200\nRebirth,20";
const retention = (): Retention => ({ game: "pet-sim", importedAt: "2026-10-20T00:00:00Z", asOf: "2026-10-20", rows: parseExport(RETENTION_CSV).rows, funnel: parseExport(FUNNEL_CSV).funnel });

const E = { blocked: false, frictions: [] }, walk = (rebirth: boolean): Walkthrough => ({ stages: { join: E, first_pet: E, first_upgrade: E, rebirth: { blocked: rebirth, frictions: [] } }, notes: "" });
const everyone = scoreAll(walk(false)), noRebirth = scoreAll(walk(true));

test("fixtures parse: retention + funnel, no errors", () => {
  assert.deepEqual(parseExport(RETENTION_CSV).errors, []);
  assert.equal(parseExport(RETENTION_CSV).rows[0].d7, 0.06);
  assert.equal(parseExport(FUNNEL_CSV).funnel.length, 4);
});

test("predict: everyone reaching rebirth vs nobody reaching it", () => {
  assert.deepEqual([predict(everyone).d1, predict(everyone).d7, predict(everyone).minutes], [1, 1, 10]);
  assert.deepEqual([predict(noRebirth).d1, predict(noRebirth).d7, predict(noRebirth)["funnel.first_upgrade"], predict(noRebirth).minutes], [1, 0, 1, 8]);
  assert.equal(predict(everyone)["funnel.join"], 1);
});

test("compare: real values, errors, shrunk factors, raw and calibrated side by side", () => {
  const { rows, factors } = compare(everyone, retention()), by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.d1.real, 0.216); // (24%*400 + 20%*600) / 1000; the two recent days are too young
  assert.equal(by.d1.n, 1000);
  assert.equal(by.d1.error, 0.784); // predicted 1.0
  assert.equal(by.d7.real, 0.048);
  assert.equal(by.minutes.real, 10); // mean of the day averages
  assert.equal(by["funnel.rebirth"].real, 0.02);
  assert.equal(by["funnel.first_pet"].real, 0.5);
  // n = 1000: weight 1000/1100, so the factor lands just above the plain ratio 0.216
  assert.equal(by.d1.factor, 0.287); assert.equal(factors.d1.n, 1000);
  assert.equal(by.d1.calibrated, 0.287); // raw 1 x factor
  assert.equal(by.minutes.factor, 1); assert.equal(by.minutes.calibrated, 10);
});

test("unknowns stay unknown: no factor, calibrated = raw", () => {
  const r = retention(); r.funnel = []; r.rows = r.rows.map((x) => ({ ...x, d1: undefined, d7: undefined }));
  const { rows, factors } = compare(everyone, r), by = Object.fromEntries(rows.map((x) => [x.key, x]));
  assert.equal(by.d1.real, null); assert.equal(by.d1.error, null); assert.equal(by.d1.factor, null); assert.equal(by.d1.calibrated, 1);
  assert.deepEqual(Object.keys(factors), ["minutes"]);
  assert.equal(compare(everyone, { ...r, rows: [] }).rows.find((x) => x.key === "minutes")!.real, null);
});

test("factor: small samples barely move it, clamps, zero prediction refused", () => {
  assert.equal(factorFor(1, 0.2, 10), 0.927); // 1 + (0.2-1) * 10/110
  assert.equal(factorFor(0, 0.2, 1000), null);
  assert.equal(factorFor(1, null, 1000), null);
  assert.equal(factorFor(0.001, 1, 1e9), 10);
  assert.equal(calibrate(0.9, 2, "rate"), 1); // rates never exceed 100%
});

test("future predictions use stored factors; metrics without one stay raw", () => {
  const { factors } = compare(everyone, retention());
  const a = Object.fromEntries(adjust(noRebirth, factors).map((x) => [x.key, x]));
  assert.equal(a.d1.calibrated, 0.287); assert.equal(a.d7.raw, 0);
  assert.equal(adjust(noRebirth, {}).find((x) => x.key === "d1")!.calibrated, 1);
  assert.equal(PERSONAS.length, 20);
});

test("cleanFactors drops junk and out-of-range values", () => {
  assert.deepEqual(cleanFactors({ d1: { factor: 0.5, n: 10 }, d7: { factor: 99, n: 10 }, minutes: { factor: 1, n: 0 }, x: { factor: 1, n: 1 }, "funnel.join": "no" }), { d1: { factor: 0.5, n: 10 } });
  assert.deepEqual(cleanFactors(null), {});
});
