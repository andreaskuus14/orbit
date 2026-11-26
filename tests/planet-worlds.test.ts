import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlanetWorld, PLANET_WORLDS } from "../src/lib/planet-worlds-pure.ts";

test("isPlanetWorld knows the five planet worlds and nothing else", () => {
  for (const id of PLANET_WORLDS) assert.ok(isPlanetWorld(id));
  assert.ok(!isPlanetWorld("memory") && !isPlanetWorld(null) && !isPlanetWorld(3));
});
