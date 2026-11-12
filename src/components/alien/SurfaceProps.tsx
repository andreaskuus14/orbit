"use client";
// Surface props (see props-pure.ts): a world covered in small themed things between its landmark towns: crystal shards,
// trees, volcanoes, rocks, pylons, little lit houses. Low-poly procedural shapes (unit height, base at y = 0), one
// InstancedMesh per kind, built once: no per-frame work. Child of the planet mesh, so it turns with it; lit by the CORE.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { propCount, scatter, type PropKind } from "@/lib/props-pure";

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, s = 1) => g.scale(s, s, s).translate(x, y, z);
const flat = (g: THREE.BufferGeometry) => g.toNonIndexed(); // mergeGeometries needs matching index state
const merge = (...g: THREE.BufferGeometry[]) => mergeGeometries(g.map(flat))!;
type Kind = { geo: () => THREE.BufferGeometry; color: string; emissive?: string; glow?: number; rough?: number; metal?: number; size: number };
const KINDS: Record<PropKind, Kind> = {
  crystal: { geo: () => merge(at(new THREE.OctahedronGeometry(0.28, 0).scale(1, 2.2, 1), 0, 0.55, 0), at(new THREE.OctahedronGeometry(0.16, 0).scale(1, 2, 1).rotateZ(0.5), 0.22, 0.3, 0.05)), color: "#6d4fc4", emissive: "#b49bff", glow: 0.9, rough: 0.2, size: 1 },
  rock: { geo: () => at(new THREE.DodecahedronGeometry(0.5, 0).scale(1, 0.6, 0.85), 0, 0.2, 0), color: "#4b4552", rough: 0.95, size: 0.8 },
  islet: { geo: () => merge(at(new THREE.CylinderGeometry(0.18, 0.32, 0.9, 6), 0, 0.35, 0), at(new THREE.DodecahedronGeometry(0.3, 0).scale(1.4, 0.4, 1.2), 0, 0.05, 0)), color: "#5c6a66", rough: 0.9, size: 0.9 },
  boulder: { geo: () => at(new THREE.DodecahedronGeometry(0.5, 0).scale(1, 0.75, 0.9), 0, 0.3, 0), color: "#a34d78", rough: 0.9, size: 0.9 },
  block: { geo: () => merge(at(new THREE.BoxGeometry(0.6, 0.6, 0.6), 0, 0.3, 0), at(new THREE.BoxGeometry(0.35, 0.35, 0.35), 0.1, 0.75, -0.05)), color: "#e7d6e0", rough: 0.6, size: 0.8 },
  pylon: { geo: () => merge(at(new THREE.CylinderGeometry(0.05, 0.09, 1.2, 5), 0, 0.6, 0), at(new THREE.SphereGeometry(0.09, 6, 4), 0, 1.22, 0)), color: "#9aa6b4", emissive: "#5cc8ff", glow: 0.35, metal: 0.7, rough: 0.35, size: 1 },
  vent: { geo: () => merge(at(new THREE.BoxGeometry(0.7, 0.25, 0.5), 0, 0.12, 0), at(new THREE.CylinderGeometry(0.1, 0.12, 0.35, 6), 0.18, 0.4, 0)), color: "#5b6470", metal: 0.6, rough: 0.45, size: 0.8 },
  house: { geo: () => merge(at(new THREE.BoxGeometry(0.5, 0.4, 0.45), 0, 0.2, 0), at(new THREE.ConeGeometry(0.42, 0.3, 4).rotateY(Math.PI / 4), 0, 0.55, 0)), color: "#8f80c8", emissive: "#ffc27a", glow: 0.55, rough: 0.7, size: 0.7 },
  conifer: { geo: () => merge(at(new THREE.CylinderGeometry(0.05, 0.06, 0.25, 5), 0, 0.12, 0), at(new THREE.ConeGeometry(0.3, 0.6, 6), 0, 0.5, 0), at(new THREE.ConeGeometry(0.22, 0.45, 6), 0, 0.82, 0)), color: "#2f6b3a", rough: 0.85, size: 1 },
  tree: { geo: () => merge(at(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 5), 0, 0.2, 0), at(new THREE.IcosahedronGeometry(0.34, 0), 0, 0.62, 0)), color: "#4f8a3f", rough: 0.85, size: 0.9 },
  bush: { geo: () => at(new THREE.IcosahedronGeometry(0.3, 0).scale(1.2, 0.75, 1), 0, 0.18, 0), color: "#3d6e35", rough: 0.9, size: 0.6 },
  shard: { geo: () => merge(at(new THREE.ConeGeometry(0.16, 1.1, 4), 0, 0.5, 0), at(new THREE.ConeGeometry(0.1, 0.6, 4).rotateZ(-0.4), 0.15, 0.25, 0)), color: "#0e0c10", emissive: "#ffb347", glow: 0.18, metal: 0.3, rough: 0.15, size: 0.9 },
  volcano: { geo: () => merge(at(new THREE.CylinderGeometry(0.14, 0.6, 0.65, 8, 1, true), 0, 0.32, 0), at(new THREE.CircleGeometry(0.14, 8).rotateX(-Math.PI / 2), 0, 0.64, 0)), color: "#2a1814", emissive: "#ff5a2a", glow: 0.6, rough: 0.95, size: 1.1 },
  jade: { geo: () => at(new THREE.DodecahedronGeometry(0.45, 0).scale(1, 0.8, 0.9), 0, 0.28, 0), color: "#1f8a64", emissive: "#ffd36a", glow: 0.12, rough: 0.25, metal: 0.2, size: 0.85 },
};

const UP = new THREE.Vector3(0, 1, 0);
export function SurfaceProps({ id, size, seed, level }: { id: string; size: number; seed: number; level: number }) {
  const meshes = useMemo(() => {
    const props = scatter(id, seed, propCount(level)), byKind = new Map<PropKind, typeof props>();
    for (const p of props) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), turn = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    return [...byKind].map(([kind, list]) => {
      const k = KINDS[kind], unit = size * 0.07 * k.size; // landmark buildings are 0.3 × the radius: props stay well under them
      const mat = new THREE.MeshStandardMaterial({ color: k.color, roughness: k.rough ?? 0.8, metalness: k.metal ?? 0, flatShading: true, emissive: k.emissive ?? k.color, emissiveIntensity: k.emissive ? k.glow ?? 0.3 : 0.35 }); // no glow of its own: a soft self-light so it reads as its colour, not a black dot (the CORE is the only light)
      const im = new THREE.InstancedMesh(k.geo(), mat, list.length);
      im.raycast = () => {}; // clicks and hover belong to the planet sphere
      list.forEach((p, i) => {
        const n = new THREE.Vector3(...p.d);
        q.setFromUnitVectors(UP, n).multiply(turn.setFromAxisAngle(UP, p.turn));
        im.setMatrixAt(i, m4.compose(pos.copy(n).multiplyScalar(size * 0.99), q, sc.setScalar(unit * p.scale)));
      });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      return im;
    });
  }, [id, size, seed, level]);
  useEffect(() => () => meshes.forEach((m) => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }), [meshes]);
  return <group>{meshes.map((m, i) => <primitive key={i} object={m} />)}</group>;
}
