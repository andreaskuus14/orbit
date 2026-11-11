import { test } from "node:test";
import assert from "node:assert/strict";
import { archPresentation, presentationModes } from "../src/lib/arch-presentation-pure.ts";
import { starterScene, type Scene } from "../src/lib/arch-pure.ts";

test("presentation variants retain the same camera poses and use numbered PNGs", () => {
  const scene = starterScene();
  const options = { site: { lat: 59.437, lon: 24.7536 }, date: new Date("2026-06-21T12:00:00Z"), quality: "preview" as const };
  const [finished, wire, exploded] = presentationModes.map((mode) => archPresentation(scene, options, 3, mode));
  const poses = (script: string) => script.match(/^P = (.+)$/m)?.[1] ?? "[]";
  assert.equal(JSON.parse(poses(finished)).length, 3);
  assert.equal(poses(wire), poses(finished));
  assert.equal(poses(exploded), poses(finished));
  assert.match(wire, /'WIREFRAME'/);
  assert.match(exploded, /evaluated_get\(depsgraph\)/);
  assert.match(finished, /'f%03d\.png'/);
});

// four separate walls, so the exploded view has somewhere to push them; a window and a door in two of them
export const houseScene = (): Scene => {
  const wall = (id: string, x: number, z: number, w: number, d: number) => ({ id, kind: "wall" as const, name: `Wall ${id}`, x, y: 0.2, z, w, d, h: 2.8 });
  const base = starterScene();
  return { ...base, parts: [...base.parts.filter((p) => p.kind !== "wall"), wall("n1", 0, -4, 10, 0.3), wall("s1", 0, 4, 10, 0.3), wall("e1", 5, 0, 0.3, 8), wall("w1", -5, 0, 0.3, 8),
    { id: "win1", kind: "window", name: "Window", host: "n1", face: "n", x: 0, y: 1, z: -4, w: 2, d: 0.1, h: 1.2 },
    { id: "door1", kind: "door", name: "Door", host: "s1", face: "s", x: 1, y: 0.2, z: 4, w: 1, d: 0.1, h: 2.1 }] };
};

test("presentation reuses the film's frame loop and the exploded view moves openings with their wall, never the slab below ground", () => {
  const scene = houseScene();
  const options = { site: { lat: 59.437, lon: 24.7536 }, date: new Date("2026-06-21T12:00:00Z"), quality: "preview" as const };
  const exploded = archPresentation(scene, options, 3, "exploded");
  assert.equal(exploded.match(/os\.makedirs/g)?.length, 1);
  assert.equal(exploded.match(/to_track_quat\('-Z'/g)?.length, 1);
  const openings = scene.parts.filter((p) => p.kind === "window" || p.kind === "door");
  assert.ok(openings.length);
  for (const o of openings) assert.match(exploded, new RegExp(`obj\\["${o.id}"\\] = box\\(`)); // panes and leaves are in obj
  assert.match(exploded, /"win1":\["opening","n1"\]/);
  assert.match(exploded, /"slab":0\.3/); // up, so it stays above the ground
  assert.match(archPresentation(scene, options, 3, "finished"), /for k in \[\] if k in obj/); // roof left alone
});
