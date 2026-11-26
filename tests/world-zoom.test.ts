import { test } from "node:test";
import assert from "node:assert/strict";
import { chipPrio, chipShows, flyTo, itemReach, zoomIn, zoomLevel } from "../src/lib/world-zoom-pure.ts";

test("zoomIn maps max..min distance to 0..1 and clamps", () => {
  assert.equal(zoomIn(30, 6, 30), 0);
  assert.equal(zoomIn(6, 6, 30), 1);
  assert.equal(zoomIn(100, 6, 30), 0);
  assert.equal(zoomIn(1, 6, 30), 1);
  assert.equal(zoomIn(5, 5, 5), 0);
});

test("zoom level steps from overview to parts to items as you come closer", () => {
  assert.equal(zoomLevel(29, 6, 30), 0);
  assert.equal(zoomLevel(18, 6, 30), 1);
  assert.equal(zoomLevel(8, 6, 30), 2);
});

test("zoom level holds near a border (no flicker)", () => {
  const border = 30 - 0.38 * 24; // z = 0.38
  assert.equal(zoomLevel(border, 6, 30, 1), 1);
  assert.equal(zoomLevel(border, 6, 30, 0), 0);
});

test("overview chips show until item level; items only when zoomed in and near", () => {
  assert.ok(chipShows(0, 0, 50, 5));
  assert.ok(chipShows(0, 1, 50, 5));
  assert.ok(!chipShows(undefined, 2, 50, 5));
  assert.ok(!chipShows(1, 0, 1, 5));
  assert.ok(chipShows(1, 1, 50, 5));
  assert.ok(!chipShows(2, 1, 1, 5));
  assert.ok(chipShows(2, 2, 4, 5));
  assert.ok(!chipShows(2, 2, 9, 5));
});

test("labels of the current level win the space", () => {
  assert.ok(chipPrio(2, 2, 1) > chipPrio(0, 2, 50));
  assert.ok(chipPrio(0, 0, 1) > chipPrio(1, 0, 1) - 1);
});

test("a click flies one level deeper", () => {
  const d0 = flyTo(0, 6, 30), d1 = flyTo(1, 6, 30), d2 = flyTo(2, 6, 30);
  assert.ok(d0 > d1 && d1 > d2 && d2 > 6 && d2 < 8);
  assert.equal(zoomLevel(d0, 6, 30), 1);
  assert.equal(zoomLevel(d1, 6, 30), 2);
  assert.ok(itemReach(6, 30) >= 9.6 && itemReach(6, 30) < 12);
});
