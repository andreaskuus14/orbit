import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, declutter, distFade, newsPins, parsePlaces, pinTime, placesQuery, ptile, ptileBox, stem, storyCat, validPTile } from "../src/lib/earth-ee-places-pure.ts";
import { oldTown, wallTint } from "../src/lib/earth-ee3d-look-pure.ts";

test("z13 tiles cover Estonia and round-trip", () => {
  const t = ptile(24.745, 59.437), b = ptileBox(t.x, t.y);
  assert.ok(validPTile(t.x, t.y) && b.w <= 24.745 && b.e > 24.745 && b.s <= 59.437 && b.n > 59.437);
  assert.ok(validPTile(ptile(26.72, 58.38).x, ptile(26.72, 58.38).y));
  assert.equal(validPTile(ptile(2.35, 48.85).x, ptile(2.35, 48.85).y), false);
  assert.match(placesQuery(b), /place.*suburb.*townhall/s);
});

test("classify and parse OSM places (Overpass centres and OSM API ways)", () => {
  assert.equal(classify({ place: "suburb" })?.kind, "district");
  assert.equal(classify({ amenity: "townhall" })?.type, "townhall");
  assert.equal(classify({ shop: "bakery" }), null);
  const p = parsePlaces({ elements: [
    { type: "node", id: 1, lat: 59.4373, lon: 24.7453, tags: { amenity: "townhall", name: "Tallinna raekoda", "name:en": "Tallinn Town Hall" } },
    { type: "node", id: 2, lat: 59.44, lon: 24.73, tags: { place: "neighbourhood", name: "Kalamaja" } },
    { type: "node", id: 3, lat: 59.441, lon: 24.731, tags: { place: "quarter", name: "Kalamaja" } }, // same name close by: kept once
    { type: "node", id: 10, lat: 59.43, lon: 24.74 }, { type: "node", id: 11, lat: 59.432, lon: 24.742 },
    { type: "way", id: 5, nodes: [10, 11], tags: { historic: "castle", name: "Toompea loss" } },
    { type: "way", id: 6, center: { lat: 59.44, lon: 24.76 }, tags: { amenity: "ferry_terminal", name: "D-terminal" } },
    { type: "node", id: 7, lat: 1, lon: 1, tags: { amenity: "cafe", name: "x" } },
  ] });
  assert.deepEqual(p.map((x) => x.name), ["Tallinna raekoda (Tallinn Town Hall)", "Toompea loss", "Kalamaja", "D-terminal"]);
  const castle = p.find((x) => x.type === "castle")!; assert.ok(Math.abs(castle.lat - 59.431) < 1e-6 && Math.abs(castle.lon - 24.741) < 1e-6);
});

test("story categories, times and pins", () => {
  assert.equal(storyCat("Traffic disruption on Suur-Karja street"), "transport");
  assert.equal(storyCat("Kiek in de Kökis avatakse uus näitus"), "culture");
  assert.equal(storyCat("Raekoja platsil algab jõuluturg"), "events");
  assert.equal(storyCat("Linnavalitsus kinnitas eelarve"), "city");
  const now = Date.parse("2026-11-26T12:00:00Z");
  assert.equal(pinTime("2026-11-26T09:05:00Z", now, "Europe/Tallinn"), "11:05");
  assert.match(pinTime("2026-11-24T09:05:00Z", now, "Europe/Tallinn"), /^[A-Z][a-z]{2} 11:05$/);
  assert.equal(pinTime(null, now), "");
  assert.equal(stem("Kalamaja"), "kalamaj");
  const s = (title: string, h: number) => ({ title, url: `https://x.ee/${h}`, source: "ERR", published_at: new Date(now - h * 36e5).toISOString() });
  const pins = newsPins([{ name: "Tallinn", lon: 24.75, lat: 59.437, kind: "city", count: 40, stories: [s("Linnas uus eelarve", 1), s("Kalamajas avati park", 2), s("Kolmas", 3), s("Neljas", 4), s("Viies", 5)] },
    { name: "Tartu", lon: 26.72, lat: 58.38, kind: "city", count: 3, stories: [s("Tartu uudis", 1)] }], now, 12,
    [{ name: "Kalamaja", kind: "district", type: "district", lon: 24.73, lat: 59.445, pri: 80 }]);
  assert.equal(pins.filter((p) => p.story.url.startsWith("https://x.ee")).length, 5); // 4 Tallinn + 1 Tartu
  const k = pins.find((p) => p.story.title.startsWith("Kalamajas"))!; assert.equal(k.lon, 24.73); assert.equal(k.place, "Kalamaja, Tallinn");
  const lead = pins.find((p) => p.story.title.startsWith("Linnas"))!; assert.equal(lead.lon, 24.75);
  const others = pins.filter((p) => p.place === "Tallinn" && p !== lead); assert.ok(others.every((p) => p.lon !== 24.75));
});

test("declutter: no overlaps, panels kept clear, weights win, caps hold", () => {
  const area: [number, number, number, number] = [0, 50, 900, 700], panel: [number, number, number, number] = [700, 0, 1000, 700];
  const c = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, x: 100 + (i % 8) * 70, y: 120 + Math.floor(i / 8) * 60, w: 110, h: 18, pri: i, lead: i % 2 ? 20 : 0, group: i % 3 ? "l" : "d" }));
  const out = declutter(c, area, [panel], 4, { d: 3 });
  assert.ok(out.length > 4);
  const boxes = out.map((p) => [p.bx, p.by, p.bx + 110, p.by + 18]);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]; assert.ok(a[2] <= 700 && a[0] >= 0 && a[1] >= 50);
    for (let j = i + 1; j < boxes.length; j++) { const b = boxes[j]; assert.ok(!(a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]), `${out[i].id} hits ${out[j].id}`); }
  }
  assert.ok(out.filter((p) => +p.id.slice(1) % 3 === 0).length <= 3);
  assert.equal(out[0].id, "c39");
  assert.equal(declutter([{ id: "a", x: 800, y: 300, w: 50, h: 10, pri: 1 }], area, [panel]).length, 0);
});

test("distance fade and old-town walls", () => {
  assert.equal(distFade(0.5, 1, 3), 1); assert.equal(distFade(3, 1, 3), 0); assert.equal(distFade(2, 1, 3), 0.5);
  assert.ok(oldTown(24.745, 59.437) && oldTown(26.72, 58.38) && !oldTown(24.733, 59.4455));
  const warm = Array.from({ length: 200 }, (_, i) => wallTint(i, 12, true)), avg = (k: number) => warm.reduce((s, c) => s + c[k], 0) / warm.length;
  assert.ok(avg(0) > avg(2) * 1.25, "old-town walls lean warm");
  assert.ok(new Set(warm.map((c) => c.map((v) => v.toFixed(3)).join())).size > 50, "varied per building");
  assert.deepEqual(wallTint(9, 12, true), wallTint(9, 12, true));
});
