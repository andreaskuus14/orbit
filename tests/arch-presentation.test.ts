import { test } from "node:test";
import assert from "node:assert/strict";
import { archPresentation, presentationModes } from "../src/lib/arch-presentation-pure.ts";
import { starterScene } from "../src/lib/arch-pure.ts";

test("presentation variants retain the same camera poses and use numbered PNGs", () => {
  const scene = starterScene();
  const options = { site: { lat: 59.437, lon: 24.7536 }, date: new Date("2026-06-21T12:00:00Z"), quality: "preview" as const };
  const [finished, wire, exploded] = presentationModes.map((mode) => archPresentation(scene, options, 3, mode));
  const poses = (script: string) => script.match(/^poses = (.+)$/m)?.[1] ?? "[]";
  assert.equal(JSON.parse(poses(finished)).length, 3);
  assert.equal(poses(wire), poses(finished));
  assert.equal(poses(exploded), poses(finished));
  assert.match(wire, /'WIREFRAME'/);
  assert.match(exploded, /evaluated_get\(depsgraph\)/);
  assert.match(finished, /'f%03d\.png'/);
});
