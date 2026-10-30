import { test } from "node:test";
import assert from "node:assert/strict";
import { cohorts, csvRows, funnelRates, parseExport } from "../src/lib/gamedev-retention-pure.ts";
import { SEED_WORLD, validateDevWorld } from "../src/lib/devworld-pure.ts";

const CSV = `Date,New Users,"D1 Retention","D7 Retention",Sessions,Avg Session Length (min),Region
2026-10-01,200,30%,10%,500,8.5,EU
2026-10-02,100,0.25,0.08,240,7,EU
2026-10-05,"1,000",20%,,2000,6,EU
2026-10-09,50,,,90,5,EU
2026-10-10,40,,,80,5,EU`;

test("csv: quotes, thousands separators, semicolons", () => {
  assert.deepEqual(csvRows('a;"b;c";"say ""hi"""\n1;2;3'), [["a", "b;c", 'say "hi"'], ["1", "2", "3"]]);
  const p = parseExport(CSV);
  assert.deepEqual(p.errors, []); assert.deepEqual(p.ignored, ["Region"]);
  assert.equal(p.rows[2].users, 1000); assert.equal(p.rows[0].d1, 0.3); assert.equal(p.rows[1].d1, 0.25); assert.equal(p.rows[2].d7, undefined);
});

test("no sample size column is refused; funnel export parses", () => {
  assert.match(parseExport("Date,D1\n2026-10-01,30%").errors[0], /sample sizes/);
  const f = parseExport("Step,Users\nJoined,1000\nFirst egg,600\nFirst rebirth,150");
  assert.deepEqual(funnelRates(f.funnel).map((s) => [s.fromPrev, s.fromStart]), [[100, 100], [60, 60], [25, 15]]);
});

test("cohorts join release windows with dates and sizes; immature cohorts stay unknown", () => {
  const { rows } = parseExport(CSV);
  const rel = [{ id: "r1", build: "v1", at: "2026-10-02T12:00:00Z" }, { id: "r2", build: "v2", at: "2026-10-09T09:00:00Z" }];
  const c = cohorts({ rows, asOf: "2026-10-10" }, rel);
  assert.deepEqual(c.map((x) => [x.release, x.from, x.to, x.users]), [[null, "2026-10-01", "2026-10-01", 200], ["r1", "2026-10-02", "2026-10-05", 1100], ["r2", "2026-10-09", "2026-10-10", 90]]);
  assert.equal(c[0].d1.value, 0.3); assert.equal(c[0].d7.value, 0.1);
  assert.deepEqual(c[1].d7, { value: 0.08, n: 100, immature: 1000 }); // 10-05 + 7 > asOf
  assert.equal(c[1].d1.value, 0.205); // (0.25*100 + 0.2*1000) / 1100
  assert.equal(c[2].d1.value, null); assert.equal(c[2].d7.value, null); assert.equal(c[2].small, true);
});

test("retention import round-trips through dev world validation, one per game", () => {
  const w = structuredClone(SEED_WORLD);
  const imp = { game: "pet-sim", importedAt: "2026-10-11T00:00:00Z", asOf: "2026-10-10", rows: parseExport(CSV).rows, funnel: [] };
  w.retention = [imp, { ...imp, asOf: "2026-10-01" }, { ...imp, game: "gone" }];
  const r = validateDevWorld(w); assert.ok(r.ok);
  if (r.ok) { assert.equal(r.world.retention?.length, 1); assert.equal(r.world.retention?.[0].rows.length, 5); }
  w.retention = [{ ...imp, asOf: "10/10/2026" }];
  assert.equal(validateDevWorld(w).ok, false);
});
