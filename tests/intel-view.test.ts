import { test } from "node:test";
import assert from "node:assert/strict";
import { readWeather, escBack, detailFor, detailStale, overlaps, TABS, DETAIL_MAX_TILES } from "../src/lib/intel-view-pure.ts";

const store = (o: Record<string, string>) => (k: string) => o[k] ?? null;
test("weather layer: saved choice wins, an old weather-map choice turns it on, off by default", () => {
  assert.equal(readWeather(store({})), false);
  assert.equal(readWeather(store({ "orbit.intel.weather": "on" })), true);
  assert.equal(readWeather(store({ "orbit.intel.weather": "off", "orbit.intel.map": "weather" })), false);
  assert.equal(readWeather(store({ "orbit.intel.map": "weather" })), true);
  assert.equal(readWeather(store({ "orbit.earth.view": "weather" })), true);
  assert.equal(readWeather(store({ "orbit.intel.map": "classic" })), false);
});
test("one map: four tabs, all places, no Classic or Weather tab", () => {
  assert.deepEqual(TABS.map((t) => t.id), ["orbit", "country", "region", "town"]);
});
test("Esc from any place goes to the whole Earth; at the whole Earth it does nothing", () => {
  for (const p of ["country", "region", "town"] as const) assert.equal(escBack(p), "orbit");
  assert.equal(escBack("orbit"), null);
});
test("detail: sharper when lower, inside the tile budget, none from far out", () => {
  assert.equal(detailFor(10, 46, 9000, 1440), null);
  const hi = detailFor(10, 46, 2000, 1440)!, mid = detailFor(10, 46, 300, 1440)!, lo = detailFor(10, 46, 20, 1920)!;
  assert.ok(hi.z < mid.z && mid.z < lo.z, `${hi.z} ${mid.z} ${lo.z}`);
  assert.ok(lo.z <= 15 && lo.ze <= 12);
  for (const d of [hi, mid, lo]) {
    const n = 2 ** d.z, nx = Math.floor(((d.box.e + 180) / 360) * n) - Math.floor(((d.box.w + 180) / 360) * n) + 1;
    assert.ok(nx * nx <= DETAIL_MAX_TILES * 2, "about the budget");
    assert.ok(d.box.w < 10 && d.box.e > 10 && d.box.s < 46 && d.box.n > 46);
  }
});
test("detail: rebuilt only after a real move", () => {
  const h = { lon: 10, lat: 46, alt: 300 };
  assert.equal(detailStale(null, 10, 46, 300), true);
  assert.equal(detailStale(h, 10.1, 46, 320), false);
  assert.equal(detailStale(h, 10, 46, 600), true);
  assert.equal(detailStale(h, 13, 46, 300), true);
});
test("overlaps: touching is fine, crossing is reported", () => {
  assert.deepEqual(overlaps([{ name: "a", r: [0, 0, 10, 10] }, { name: "b", r: [10, 0, 20, 10] }]), []);
  assert.deepEqual(overlaps([{ name: "a", r: [0, 0, 10, 10] }, { name: "b", r: [5, 5, 20, 20] }]), ["a × b"]);
});
