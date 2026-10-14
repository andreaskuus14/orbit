import { test } from "node:test";
import assert from "node:assert/strict";
import { geoTag, hotspots, COUNTRIES } from "../src/lib/geo.ts";
import { decodeCountries, unwrapRing } from "../src/lib/topo.ts";

test("geoTag finds the countries a headline is about", () => {
  assert.ok(geoTag("Russian drones strike Kyiv overnight").includes("Ukraine"));
  assert.ok(geoTag("Russian drones strike Kyiv overnight").includes("Russia"));
  assert.deepEqual(geoTag("Estonia's parliament votes in Tallinn"), ["Estonia"]);
  assert.deepEqual(geoTag("U.S. jobs report beats forecasts"), ["United States of America"]);
  assert.deepEqual(geoTag("Fighting continues in South Sudan"), ["S. Sudan"]);
  assert.deepEqual(geoTag("Sudan and South Sudan sign oil deal").sort(), ["S. Sudan", "Sudan"]);
});

test("geoTag ignores lowercase homonyms and unrelated text", () => {
  assert.deepEqual(geoTag("How to roast the perfect turkey with fine china"), []);
  assert.deepEqual(geoTag("Markets rally as tech stocks climb"), []);
  assert.deepEqual(geoTag("Usual suspects return"), [], "US must be a whole word");
});

test("geoTag ranks headline mentions above summary mentions and caps the result", () => {
  const tags = geoTag("Japan's exports rise", "Shipments to China, Germany, France and India grew");
  assert.equal(tags[0], "Japan");
  assert.equal(tags.length, 3);
});

test("hotspots groups stories by country, busiest first, newest stories first", () => {
  const a = (title: string, iso: string) => ({ title, url: `https://x/${title}`, source: "x", published_at: iso });
  const { hotspots: hs, untagged } = hotspots([
    a("Gaza ceasefire talks resume", "2026-10-14T10:00:00Z"),
    a("Israeli cabinet meets on Gaza", "2026-10-14T12:00:00Z"),
    a("Kyiv hit by drones", "2026-10-14T09:00:00Z"),
    a("Stocks edge higher", "2026-10-14T08:00:00Z"),
  ]);
  assert.equal(untagged, 1);
  assert.equal(hs[0].name, "Palestine");
  assert.equal(hs[0].count, 2);
  assert.equal(hs[0].stories[0].title, "Israeli cabinet meets on Gaza");
  assert.ok(hs.some((h) => h.name === "Ukraine"));
  for (const c of COUNTRIES) assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180, c.name);
});

test("decodeCountries rebuilds rings from quantized, delta-encoded arcs", () => {
  const topo = {
    transform: { scale: [1, 1] as [number, number], translate: [0, 0] as [number, number] },
    arcs: [[[0, 0], [10, 0], [0, 10]], [[10, 10], [-10, 0], [0, -10]]] as [number, number][][],
    objects: { countries: { geometries: [{ type: "Polygon", arcs: [[0, 1]], properties: { name: "Square" }, id: "1" }, { type: "Point" }] } },
  };
  const [sq, ...rest] = decodeCountries(topo);
  assert.equal(rest.length, 0, "non-polygons are skipped");
  assert.equal(sq.name, "Square");
  assert.deepEqual(sq.rings[0], [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  const rev = decodeCountries({ ...topo, objects: { countries: { geometries: [{ type: "Polygon", arcs: [[~1, ~0]] }] } } });
  assert.deepEqual(rev[0].rings[0][0], [0, 0]);
});

test("unwrapRing keeps antimeridian-crossing rings continuous", () => {
  const r = unwrapRing([[170, 0], [-170, 0], [-170, 5], [170, 5]]);
  assert.deepEqual(r.map((p) => p[0]), [170, 190, 190, 170]);
});
