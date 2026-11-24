import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { byCountry, countryAt, endingsOf, inEstonia, langOf, parseGeoLine, parseGeoNames, regionKey, toPlaces, townsInView } from "../src/lib/earth-region-pure.ts";
import { placesIn, townNews } from "../src/lib/earth-pure.ts";

const cities = parseGeoNames(readFileSync(new URL("./fixtures/earth-geonames-sample.txt", import.meta.url), "utf8"));
const by = byCountry(cities);

test("GeoNames lines parse into cities, junk is dropped", () => {
  assert.equal(cities.length, 9);
  const riga = cities.find((c) => c.name === "Riga")!;
  assert.equal(riga.cc, "LV"); assert.ok(riga.pop > 700000 && Math.abs(riga.lat - 56.946) < 1e-6);
  assert.equal(parseGeoLine("x\ty"), null);
  assert.equal(parseGeoLine("1\tLake\tLake\t\t1\t2\tH\tLK\tLV\t\t\t\t\t\t0"), null); // not a populated place
  assert.equal(by.get("LV")![0].name, "Riga"); // biggest first
});

test("country under the camera, towns in view, cache key", () => {
  const idx = cities.map((c) => ({ cc: c.cc, lon: c.lon, lat: c.lat }));
  assert.equal(countryAt(idx, 24.2, 56.9), "LV");
  assert.equal(countryAt(idx, 24.9, 60.2), "FI");
  assert.equal(countryAt(idx, -40, 40), null); // mid-Atlantic
  const near = townsInView(by.get("LV")!, 24.1, 56.95, 40, 3).map((c) => c.name);
  assert.deepEqual(near, ["Riga", "Jūrmala", "Ogre"]);
  assert.ok(!townsInView(by.get("LV")!, 24.1, 56.95, 40).some((c) => c.name === "Valmiera")); // ~100 km off, out of a 40 km view
  assert.equal(regionKey("LV", 24.11, 56.94, 80), regionKey("LV", 24.2, 56.9, 90));
  assert.notEqual(regionKey("LV", 24.11, 56.94, 80), regionKey("LV", 25.4, 57.5, 80));
  assert.ok(inEstonia(24.75, 59.43) && !inEstonia(24.1, 56.95));
  assert.equal(langOf("lv"), "lv"); assert.equal(langOf("ZZ"), "en");
});

test("headlines are pinned to towns abroad, with that language's case endings", () => {
  const lv = toPlaces(by.get("LV")!, "lv"), fi = toPlaces(by.get("FI")!);
  assert.deepEqual(placesIn("Jūrmalā atklāts jauns tilts", lv, 3, endingsOf("lv")).map((p) => p.name), ["Jūrmala"]);
  assert.deepEqual(placesIn("Jurmala beach closed", lv, 3, endingsOf("en")).map((p) => p.name), ["Jūrmala"]); // ascii stem
  assert.deepEqual(placesIn("Tampereella avattiin uusi silta", fi, 3, endingsOf("fi")).map((p) => p.name), []); // stem change (Tampere→Tamperee-) is not guessed
  assert.deepEqual(placesIn("Espoossa ja Helsingissä myrsky", fi, 3, endingsOf("fi")).map((p) => p.name), ["Espoo"]);
  assert.deepEqual(placesIn("Espoon kaupunki", fi, 3, endingsOf("fi")).map((p) => p.name), ["Espoo"]);
  assert.deepEqual(placesIn("Rigatoni recipe of the week", lv, 3, endingsOf("lv")), []); // word boundary
  // Ogre is ≤ 4 letters → strict: the first word or lower case doesn't count
  assert.deepEqual(placesIn("Ogre council meets", lv, 3, endingsOf("en")), []);
  assert.deepEqual(placesIn("Flooding hits Ogre overnight", lv, 3, endingsOf("en")).map((p) => p.name), ["Ogre"]);
  const towns = townNews([
    { title: "Riga airport: flights back on", url: "https://a", source: "LSM", published_at: "2026-11-24T08:00:00Z" },
    { title: "Rīgā... no new info", url: "https://b", source: "Delfi", published_at: "2026-11-24T09:00:00Z", feedHome: "Jelgava" },
    { title: "Riga's mayor speaks", url: "https://c", source: "LSM", published_at: "2026-11-24T10:00:00Z" },
  ], lv, 6, endingsOf("lv"));
  assert.equal(towns[0].name, "Riga"); assert.equal(towns[0].count, 2); // a big city's short name counts even as the first word
  assert.ok(towns.some((t) => t.name === "Jelgava" && t.stories[0].weak)); // searched-by-name fallback, weak
});

test("a CRLF copy of the dump (Windows checkout or editor) parses the same", () => {
  const raw = readFileSync(new URL("./fixtures/earth-geonames-sample.txt", import.meta.url), "utf8").replace(/\r?\n/g, "\r\n");
  assert.deepEqual(parseGeoNames(raw), cities);
});
