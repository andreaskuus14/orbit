// Overpass lead candidates (overpass-pure.ts): query shape, parsing a fixture, dedupe + cap, tool text, rate-limit and backoff rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ATTRIBUTION, DEFAULT_TYPES, OVERPASS_URL, backoffMs, buildQuery, candidatesText, dedupe, osmNotes, parseArea, parseOverpass, parseTypes, retryable, runBlocked, toLeadCandidate, RUNS_PER_DAY } from "../src/lib/overpass-pure.ts";
import { BUSINESS_LOOP } from "../src/lib/business-loop-pure.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/overpass-tallinn.json", import.meta.url), "utf8"));
const area = parseArea("Tallinn")!;

test("parseArea: a city, a small bbox; injection and nonsense are refused", () => {
  assert.deepEqual(parseArea(" Tallinn "), { kind: "name", name: "Tallinn" });
  assert.deepEqual(parseArea("Pärnu"), { kind: "name", name: "Pärnu" });
  assert.deepEqual(parseArea("59.40,24.60,59.50,24.90"), { kind: "bbox", s: 59.4, w: 24.6, n: 59.5, e: 24.9 });
  for (const bad of ['Tallinn"]; out;', "Tal\\linn", "", "1,2,3", "59.5,24.6,59.4,24.9", "0,0,40,40", 42, null, "123"]) assert.equal(parseArea(bad), null, String(bad));
});

test("parseTypes: bare values, key=value, junk dropped, defaults when empty", () => {
  assert.deepEqual(parseTypes(["hairdresser", "shop=florist", "craft=carpenter"]), [{ key: null, value: "hairdresser" }, { key: "shop", value: "florist" }, { key: "craft", value: "carpenter" }]);
  assert.deepEqual(parseTypes("cafe, cafe"), [{ key: null, value: "cafe" }]);
  assert.deepEqual(parseTypes(['x"]; drop', "tourism=hotel", "shop=Bad Value"]), parseTypes(DEFAULT_TYPES));
  assert.equal(parseTypes(undefined).length, DEFAULT_TYPES.length);
});

test("buildQuery: named area, website tags excluded, per-key regex, capped output", () => {
  const q = buildQuery(area, parseTypes(["hairdresser", "shop=florist", "craft=carpenter"]), 40);
  assert.match(q, /^\[out:json\]\[timeout:60\];\narea\["name"="Tallinn"\]\["boundary"="administrative"\]->\.a;/);
  assert.match(q, /nwr\(area\.a\)\["shop"~"\^\(hairdresser\|florist\)\$"\]\["name"\]\[!"website"\]\[!"contact:website"\]\[!"url"\];/);
  assert.match(q, /\["craft"~"\^\(hairdresser\|carpenter\)\$"\]/);
  assert.match(q, /\["amenity"~"\^\(hairdresser\)\$"\]/); // a bare value is tried under every key
  assert.match(q, /out center tags 40;$/);
  assert.equal(buildQuery(area, parseTypes(["cafe"]), 99999).endsWith("out center tags 150;"), true);
});

test("buildQuery: a bbox has no area clause", () => {
  const q = buildQuery(parseArea("59.4,24.6,59.5,24.9")!, parseTypes(["shop=bakery"]));
  assert.ok(!q.includes("area["));
  assert.match(q, /nwr\(59\.4,24\.6,59\.5,24\.9\)\["shop"/);
});

test("parseOverpass: fixture → candidates; sites, unnamed, disused and position-less ones are dropped", () => {
  const c = parseOverpass(fixture, "Tallinn");
  assert.deepEqual(c.map((x) => x.osmId), ["node/1001", "way/2002", "node/4004", "node/1001", "node/5005", "node/7007", "node/8008"]);
  const k = c[0];
  assert.equal(k.name, "Juuksur Kati");
  assert.equal(k.category, "hairdresser");
  assert.equal(k.address, "Narva mnt 12, 10120, Tallinn");
  assert.equal(k.phone, "+372 5555 0001"); // first of several
  assert.equal(k.osmUrl, "https://www.openstreetmap.org/node/1001");
  assert.equal(k.source, "© OpenStreetMap contributors (ODbL)");
  assert.deepEqual([k.lat, k.lon], [59.437, 24.7536]);
  assert.deepEqual([c[1].lat, c[1].lon, c[1].phone, c[1].city], [59.4301, 24.7201, "+372 600 0000", "Tallinn"]); // way: centre point, fallback city
  assert.equal(c[6].name, "Cafe Line Break"); // control characters cleaned
  assert.ok(c.every((x) => x.source === ATTRIBUTION));
});

test("parseOverpass: garbage in, nothing out", () => {
  for (const j of [null, {}, { elements: "x" }, { elements: [null, 3, {}] }, "text"]) assert.deepEqual(parseOverpass(j), []);
});

test("dedupe: repeats by id and by name+address, existing leads (name + city), cap", () => {
  const all = parseOverpass(fixture, "Tallinn");
  const d = dedupe(all, [{ name: "pagarikoda oü", notes: "City: Tallinn\nPhone: 1" }], 10);
  // 1001 once (its repeat has the same id), 5005 is the same name + address, the bakery is already a lead
  assert.deepEqual(d.map((x) => x.osmId), ["node/1001", "node/4004", "node/7007", "node/8008"]);
  assert.equal(dedupe(all, [], 2).length, 2);
  assert.equal(dedupe(all, [], 0).length, 5); // 0 falls back to the default cap of 10
  assert.equal(dedupe(all, [], 1000).length, 5); // capped at 25 (only 5 distinct here)
  // the same name in another city is a different business; in the same city it is not
  assert.equal(dedupe(all, [{ name: "Torupilli Puusepp", notes: "City: Tartu" }], 10).some((x) => x.osmId === "node/4004"), true);
  assert.equal(dedupe(all, [{ name: "Torupilli Puusepp", notes: "City: Tallinn" }], 10).some((x) => x.osmId === "node/4004"), false);
});

test("toLeadCandidate / osmNotes carry the ODbL source", () => {
  const [k] = parseOverpass(fixture, "Tallinn");
  assert.deepEqual(toLeadCandidate(k), { name: "Juuksur Kati", city: "Tallinn", category: "hairdresser" });
  const n = osmNotes(k);
  assert.match(n, /^Source: © OpenStreetMap contributors \(ODbL\), https:\/\/www\.openstreetmap\.org\/node\/1001/);
  assert.match(n, /Phone: \+372 5555 0001/);
});

test("candidatesText: says candidates are not proof and repeats the attribution", () => {
  const c = dedupe(parseOverpass(fixture, "Tallinn"), []);
  const t = candidatesText(c, "Tallinn", 2);
  assert.match(t, /NOT proof/);
  assert.match(t, /fetch_url/);
  assert.ok(t.trimEnd().endsWith(ATTRIBUTION));
  assert.match(t, /openstreetmap\.org\/node\/1001/);
  assert.match(candidatesText([], "Tallinn", 0), /No new candidates/);
  assert.ok(candidatesText([], "Tallinn", 0).includes(ATTRIBUTION));
});

test("runBlocked: daily cap, minimum gap, a new day resets", () => {
  assert.equal(runBlocked({ day: "d1", n: 0, last: 0 }, "d1", 1_000_000), "");
  assert.match(runBlocked({ day: "d1", n: RUNS_PER_DAY, last: 0 }, "d1", 1_000_000), /daily limit/);
  assert.equal(runBlocked({ day: "d1", n: RUNS_PER_DAY, last: 0 }, "d2", 1_000_000), "");
  assert.match(runBlocked({ day: "d1", n: 1, last: 999_000 }, "d1", 1_000_000), /one OpenStreetMap lookup/);
});

test("backoff: 429/504 only, honours Retry-After, gives up after two retries", () => {
  assert.equal(retryable(429) && retryable(504), true);
  assert.equal(retryable(500) || retryable(403) || retryable(400), false);
  assert.equal(backoffMs(1), 5_000);
  assert.equal(backoffMs(2), 15_000);
  assert.equal(backoffMs(3), null);
  assert.equal(backoffMs(1, "20"), 20_000);
  assert.equal(backoffMs(1, "9999"), 60_000);
  assert.equal(backoffMs(1, "soon"), 5_000);
});

test("endpoint and the business loop use it", () => {
  assert.equal(OVERPASS_URL, "https://overpass-api.de/api/interpreter");
  assert.match(BUSINESS_LOOP.prompt, /find_lead_candidates/);
  assert.match(BUSINESS_LOOP.prompt, /not proof/);
  assert.match(BUSINESS_LOOP.prompt.split("\n").find((l) => l.startsWith("2."))!, /fetch_url/); // the proof step is still there, after the candidates
});

test("timeouts (22 Nov): ORBIT waits longer than the server may run, so a slow but good answer is not aborted", async () => {
  const { QUERY_TIMEOUT_S, FETCH_TIMEOUT_MS } = await import("../src/lib/overpass-pure.ts");
  assert.ok(FETCH_TIMEOUT_MS >= QUERY_TIMEOUT_S * 1000 + 30_000, "client timeout covers the server's run plus queueing");
  assert.ok(FETCH_TIMEOUT_MS > 46_000, "the slowest measured answer (46 s) fits");
});
