import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WORLD, countryByIso2, countryByName, findCountry, wbPoints } from "../src/lib/countries-pure.ts";
import { displayName } from "../src/lib/geo.ts";

// id:name of every shape in world-atlas countries-110m.json (2.0.2), captured so this test needs no node_modules.
const ATLAS = readFileSync(new URL("./fixtures/atlas-110m-countries.txt", import.meta.url), "utf8").trim().split("|")
  .map((p) => { const i = p.indexOf(":"); return { id: p.slice(0, i), name: p.slice(i + 1) }; });

test("every UN member plus Palestine, the Vatican, Kosovo and Taiwan, each once", () => {
  assert.equal(WORLD.length, 197);
  assert.equal(new Set(WORLD.map((c) => c.iso2)).size, 197);
  assert.equal(new Set(WORLD.map((c) => c.id)).size, 197);
  for (const c of WORLD) {
    assert.match(c.iso2, /^[A-Z]{2}$/, c.name);
    assert.match(c.id, /^(\d{3}|XKX)$/, c.name);
    assert.match(c.lang, /^[a-z]{2}$/, c.name);
  }
});

test("names match the atlas: same ISO numeric id for every shape the atlas has", () => {
  for (const c of WORLD) {
    const shape = ATLAS.find((a) => a.name === c.name);
    if (shape?.id) assert.equal(shape.id, c.id, c.name);
  }
  // A country the atlas has under another name would silently lose its shape.
  for (const a of ATLAS) if (a.id) { const w = WORLD.find((c) => c.id === a.id); if (w) assert.equal(w.name, a.name); }
});

test("countries without an atlas shape (small states) all have a marker position, and only they do", () => {
  const shaped = new Set(ATLAS.map((a) => a.name));
  const missing = WORLD.filter((c) => !shaped.has(c.name));
  assert.ok(missing.length >= 25, "the 110m atlas drops many small states");
  for (const c of missing) assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lon), `${c.name} needs lat/lon`);
  for (const c of WORLD.filter((x) => shaped.has(x.name))) assert.equal(c.lat, undefined, `${c.name} has a shape`);
  for (const n of ["Malta", "Singapore", "Bahrain", "Andorra", "Monaco", "Maldives"]) assert.ok(missing.some((c) => c.name === n), n);
});

test("lookups: ISO2, atlas name, display name, any case", () => {
  assert.equal(countryByIso2("ee")?.name, "Estonia");
  assert.equal(countryByIso2("EE")?.lang, "et");
  assert.equal(countryByName("Dem. Rep. Congo")?.iso2, "CD");
  assert.equal(countryByName("Nowhere"), null);
  assert.equal(findCountry("malta")?.iso2, "MT");
  assert.equal(findCountry("SG")?.name, "Singapore");
  assert.equal(findCountry("north macedonia", displayName)?.iso2, "MK");
  assert.equal(findCountry("United States", displayName)?.iso2, "US");
  assert.equal(findCountry("  "), null);
});

test("wbPoints: World Bank rows → oldest-first points, null years skipped; error answers throw (never cached as no data)", () => {
  const head = { page: 1, pages: 1, per_page: 40, total: 3 };
  assert.deepEqual(wbPoints([head, [{ date: "2025", value: null }, { date: "2024", value: 43.1 }, { date: "2023", value: 41.5 }]]), [{ y: 2023, v: 41.5 }, { y: 2024, v: 43.1 }]);
  assert.deepEqual(wbPoints([{ page: 1, pages: 0, per_page: 40, total: 0 }, null]), []); // a real "no data"
  assert.throws(() => wbPoints([{ message: [{ id: "120", key: "Invalid value" }] }]));
  assert.throws(() => wbPoints({}));
  assert.throws(() => wbPoints(null));
});
