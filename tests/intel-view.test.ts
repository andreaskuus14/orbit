import { test } from "node:test";
import assert from "node:assert/strict";
import { readView, escBack, currentTab, detailFor, detailStale, overlaps, TABS, DETAIL_MAX_TILES } from "../src/lib/intel-view-pure.ts";

const store = (o: Record<string, string>) => (k: string) => o[k] ?? null;
test("view: new key wins, old keys migrate, Earth by default", () => {
  assert.equal(readView(store({})), "earth");
  assert.equal(readView(store({ "orbit.intel.map": "classic" })), "classic");
  assert.equal(readView(store({ "orbit.earth.view": "weather" })), "weather");
  assert.equal(readView(store({ "orbit.earth.view": "weather", "orbit.newsWeather.view": "classic" })), "classic");
  assert.equal(readView(store({ "orbit.earth.view": "earth", "orbit.newsWeather.view": "classic" })), "earth");
});
test("every view has a lit tab and a way back to the Earth", () => {
  for (const v of ["earth", "weather", "classic"] as const) for (const p of ["orbit", "country", "region", "town"] as const) {
    const tab = currentTab(v, p);
    assert.ok(TABS.some((t) => t.id === tab));
    const b = escBack(v, p);
    if (v === "earth" && p === "orbit") assert.equal(b, null); else assert.deepEqual(b, { view: "earth", place: "orbit" });
  }
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
