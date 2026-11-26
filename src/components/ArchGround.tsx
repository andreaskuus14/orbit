"use client";
// ARCH site, tier 1+ (v12): the meadow. A real CC0 grass PBR lawn (./arch-lawn: two scales blended, colour drift, a faint mown pattern, contact
// occlusion at the wall foot) on soft swells that run flat under the house and ease out to a far plane the haze swallows. Real conifers (Poly Haven
// fir, cut down) stand 20-46 m out behind and beside the house, and a broken line of them 70-140 m out is the forest edge against the HDRI horizon:
// no drawn tree ring, no weeds on the lawn. One instanced draw call per part (AssetMany). The numbers are in lib/arch-ground-pure.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { farMesh, groundMesh, horizonTrees, meadowHeight, treePlan } from "@/lib/arch-ground-pure";
import { shotSector } from "@/lib/arch-camera-pure";
import { AssetMany } from "./world-assets";
import { ArchFirs, type Fir } from "./ArchFirs";
import { useTex } from "./world-surfaces";
import { lawnMaterial } from "./arch-lawn";
import type { Inst } from "./world-kit";

export const groundAt = (x: number, z: number, r: number) => { const a = Math.atan2(z, x), rho = Math.min(1, Math.hypot(x, z) / r); return meadowHeight(rho, a, r); };

export function RealGround({ r, fp }: { r: number; fp: { x0: number; x1: number; z0: number; z1: number } | null }) {
  const [d, n, ro] = useTex("lawnD", "lawnN", "lawnR");
  const grass = useMemo(() => lawnMaterial({ d, n, r: ro, fp }), [d, n, ro, fp]);
  const lawn = useMemo(() => {
    const m = groundMesh(r, 96, meadowHeight), g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(m.col, 3)); g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }, [r]);
  const far = useMemo(() => { // flat ground beyond the lawn, joined to its rim ring and coloured by the same function
    const m = farMesh(r), g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(m.col, 3)); g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }, [r]);
  useEffect(() => () => { grass.dispose(); lawn.dispose(); far.dispose(); }, [grass, lawn, far]);
  return <group>
    <mesh geometry={lawn} material={grass} receiveShadow />
    <mesh geometry={far} material={grass} />
  </group>;
}

/** Conifers: a few close ones behind and beside the house (11-16 m), a broken line far out for the horizon (no shadows: the far ones are too small to matter),
 *  and a few mossy rocks. Nothing on the lawn itself. */
export function RealPlants({ r, fp }: { r: number; fp: { x0: number; x1: number; z0: number; z1: number } | null }) {
  const set = useMemo(() => {
    const y = (x: number, z: number, d = 0) => groundAt(x, z, r) + d, plan = treePlan(r, fp, shotSector());
    const near: Fir[] = plan.mid.map((t, i) => ({ x: t.x, z: t.z, y: y(t.x, t.z, -0.05), h: 10 + 4 * t.s, ry: i * 2.17, v: (i % 2) as 0 | 1 }));
    const far: Fir[] = horizonTrees().map((t) => ({ x: t.x, z: t.z, y: -0.1, h: t.h, ry: t.ry, v: t.v }));
    return { near, far, rocks: plan.mid.filter((_, i) => i % 3 === 0).map((t, i): Inst => ({ at: [t.x + 2.2, y(t.x + 2.2, t.z + 1, -0.12), t.z + 1], s: [1, 0.5 + (i % 3) * 0.25, 1], ry: i * 3 })) };
  }, [r, fp]);
  return <>
    <ArchFirs items={set.near} shadow />
    <ArchFirs items={set.far} shadow={false} far />
    <AssetMany id="rocks" items={set.rocks} />
  </>;
}
