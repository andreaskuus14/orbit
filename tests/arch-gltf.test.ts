import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cutWall, toGlb } from "../src/lib/arch-gltf-pure.ts";
import { planToScene, samplePlan } from "../src/lib/arch-floorplan-pure.ts";
import { kitHouse } from "../src/lib/arch-kit-pure.ts";
import type { Part } from "../src/lib/arch-pure.ts";

const load = (glb: Uint8Array) => new Promise<THREE.Group>((ok, no) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, "", (g) => ok(g.scene), no));

test("a window cuts its wall into side, sill and lintel pieces with the same total volume minus the hole", () => {
  const wall = { x: 0, y: 0, z: 0, w: 6, d: 0.3, h: 2.7 };
  const win = { id: "o", kind: "window", name: "w", host: "w", face: "s", x: 1, y: 0.9, z: 0.15, w: 1.2, d: 0.08, h: 1.2 } as Part;
  const pieces = cutWall(wall, [win]);
  assert.equal(pieces.length, 4);
  const vol = pieces.reduce((s, b) => s + b.w * b.d * b.h, 0);
  assert.ok(Math.abs(vol - (6 * 2.7 - 1.2 * 1.2) * 0.3) < 1e-9);
});

test("GLB header and chunks follow the glTF 2.0 binary layout", () => {
  const glb = toGlb(planToScene(samplePlan()).scene), dv = new DataView(glb.buffer, glb.byteOffset);
  assert.equal(dv.getUint32(0, true), 0x46546c67); assert.equal(dv.getUint32(4, true), 2); assert.equal(dv.getUint32(8, true), glb.byteLength);
  const jl = dv.getUint32(12, true); assert.equal(dv.getUint32(16, true), 0x4e4f534a); assert.equal(jl % 4, 0);
  const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jl)));
  assert.equal(json.asset.version, "2.0");
  assert.equal(dv.getUint32(20 + jl + 4, true), 0x004e4942);
  assert.equal(dv.getUint32(20 + jl, true), json.buffers[0].byteLength);
});

test("three.js reads the house back at the right size (an outside parser, not ours)", async () => {
  const built = planToScene(samplePlan()).scene, g = await load(toGlb(built, "Sample"));
  const box = new THREE.Box3().setFromObject(g);
  // footprint 12.3 m to the outer faces, flat roof pieces 0.2 m over; ground −0.8 m (footings) to roof top 0.2 + 2.7 + 0.3
  assert.ok(Math.abs(box.max.x - box.min.x - 12.7) < 1e-4, String(box.max.x - box.min.x));
  assert.ok(Math.abs(box.min.y + 0.8) < 1e-4 && Math.abs(box.max.y - 3.2) < 1e-4);
  const glass: THREE.Object3D[] = []; g.traverse((o) => { if (/^Window/.test(o.name) && (o as THREE.Mesh).isMesh) glass.push(o); }); // the loader makes names unique: Window, Window_1…
  assert.equal(glass.length, 8);
  assert.ok((glass[0] as THREE.Mesh).material instanceof THREE.MeshStandardMaterial && ((glass[0] as THREE.Mesh).material as THREE.Material).transparent);
  // a hand-made kit house (shell walls) exports too
  const kit = await load(toGlb(kitHouse()));
  assert.ok(kit.children.length > 5);
});
