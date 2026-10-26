import { test } from "node:test";
import assert from "node:assert/strict";
import { coarse, currentPoint, haversineKm, nearestPlace, parsePlaces, parsePoint, placeLines, type PlaceState } from "../src/lib/place-pure.ts";
import { briefItems } from "../src/lib/brief-pure.ts";

const home = { name: "Home", lat: 59.44, lon: 24.75, pc: true };
const school = { name: "School", lat: 59.40, lon: 24.66 };
const now = Date.parse("2026-10-26T07:00:00Z");
const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
const state = (lat: number, lon: number, over: Partial<PlaceState> = {}): PlaceState => ({ on: true, places: [home, school], last: { lat, lon, at: at(1) }, ...over });

test("coarse: rounds to 2 decimals (~1 km), parsePoint rejects junk", () => {
  assert.equal(coarse(59.43712), 59.44);
  assert.equal(coarse(-24.7549), -24.75);
  assert.deepEqual(parsePoint({ lat: 59.43712, lon: 24.75381 }), { lat: 59.44, lon: 24.75 });
  for (const bad of [null, {}, { lat: "59", lon: 24 }, { lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: NaN, lon: 0 }]) assert.equal(parsePoint(bad), null);
});

test("haversine: known distance and zero", () => {
  assert.equal(haversineKm(home, home), 0);
  const tallinnTartu = haversineKm({ lat: 59.437, lon: 24.7536 }, { lat: 58.378, lon: 26.729 });
  assert.ok(Math.abs(tallinnTartu - 160) < 5, String(tallinnTartu));
});

test("nearestPlace: closest within 2 km, else null", () => {
  assert.equal(nearestPlace({ lat: 59.45, lon: 24.75 }, [home, school])?.name, "Home");
  assert.equal(nearestPlace({ lat: 59.40, lon: 24.67 }, [home, school])?.name, "School");
  assert.equal(nearestPlace({ lat: 58.38, lon: 26.73 }, [home, school]), null);
  assert.equal(nearestPlace(home, []), null);
});

test("currentPoint: off, missing or stale points say nothing", () => {
  assert.ok(currentPoint(state(59.4, 24.66), now));
  assert.equal(currentPoint(state(59.4, 24.66, { on: false }), now), null);
  assert.equal(currentPoint(state(59.4, 24.66, { last: { lat: 59.4, lon: 24.66, at: at(13) } }), now), null);
  assert.equal(currentPoint({ on: true, places: [] }, now), null);
});

test("placeLines: near a place with a matching waiting item, and away from the PC", () => {
  const lines = placeLines(state(59.40, 24.66), now, ["Buy glue at school", "Approve the pet sim refactor"], 2);
  assert.equal(lines.length, 2);
  assert.match(lines[0].say, /^You're near School, and “Buy glue at school” is waiting\.$/);
  assert.match(lines[1].say, /away from your PC at School\. 2 things need the PC/);
  assert.ok(lines.every((l) => !/\d+\.\d{2}/.test(l.say)), "coordinates never in the text");
});

test("placeLines: nothing when off, at the PC, nothing matches or nothing needs the PC", () => {
  assert.deepEqual(placeLines(state(59.40, 24.66, { on: false }), now, ["Buy glue at school"], 3), []);
  assert.deepEqual(placeLines(state(59.44, 24.75), now, ["Buy glue at school"], 3), [], "at Home (the PC place) with no Home item");
  assert.deepEqual(placeLines(state(59.40, 24.66), now, ["Schoolbag shopping"], 0), [], "whole-word match only");
  const away = placeLines(state(58.38, 26.73), now, [], 1);
  assert.deepEqual(away.map((l) => l.say), ["You're away from your PC. One thing needs the PC, so leave it for later."]);
  assert.deepEqual(placeLines({ on: true, places: [school], last: { lat: 58.38, lon: 26.73, at: at(1) } }, now, [], 4), [], "no PC place saved");
});

test("parsePlaces: cleans names, rounds, one PC place, no duplicates", () => {
  const p = parsePlaces([{ name: " Home<script> ", lat: 59.437, lon: 24.7536, pc: true }, { name: "Studio", lat: 59.43, lon: 24.74, pc: true }]);
  assert.ok(p.ok);
  assert.deepEqual(p.ok && p.places, [{ name: "Homescript", lat: 59.44, lon: 24.75, pc: true }, { name: "Studio", lat: 59.43, lon: 24.74 }]);
  assert.equal(parsePlaces([{ name: "Home", lat: 1, lon: 1 }, { name: "home", lat: 2, lon: 2 }]).ok, false);
  assert.equal(parsePlaces([{ name: "", lat: 1, lon: 1 }]).ok, false);
  assert.equal(parsePlaces("x").ok, false);
});

test("brief: place lines become place items after the calendar", () => {
  const items = briefItems({ day: "2026-10-26", hour: 8, life: false, morning: { calendar: { connected: true, today: [{ time: "10:00", title: "x" }] } },
    decisions: [], replies: [], snoozed: [], place: [{ id: "place:away", title: "Away", say: "You're away from your PC." }] });
  assert.deepEqual(items.map((i) => i.kind), ["calendar", "place"]);
});
