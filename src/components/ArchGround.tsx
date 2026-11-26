"use client";
// ARCH worlds v7 (tier 1+): the plot's ground as real terrain instead of a flat disc. Grass from a CC0 Poly Haven texture on the
// top, cliff rock on the steep rim (triplanar, picked by slope), so the lawn rolls over the edge into the rock with no visible
// rim. The numbers are in lib/arch-ground-pure; the mesh and the rock under it share their rim ring. Real trees (Poly Haven),
// shrubs, ferns, flowers and mossy rocks stand on it; each is one instanced draw call per part (AssetMany).
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { groundMesh, groundY, meadowSpots, rimSpots, rockMesh } from "@/lib/arch-ground-pure";
import type { SiteLayout } from "@/lib/arch-mesh-pure";
import { AssetMany } from "./world-assets";
import { triplanarMaterial, useTex } from "./world-surfaces";
import type { Inst } from "./world-kit";

export function RealGround({ r }: { r: number }) {
  const [gD, gN, cD, cN] = useTex("grassD", "grassN", "cliffD", "cliffN");
  const grass = useMemo(() => { const m = triplanarMaterial({ d: cD, n: cN, scale: 0.16 }, { d: gD, n: gN, scale: 0.34 }, { slope: 0.8, roughness: 0.96, normal: 0.8 }); m.vertexColors = true; return m; }, [gD, gN, cD, cN]);
  const rock = useMemo(() => triplanarMaterial({ d: cD, n: cN, scale: 0.15 }, undefined, { tint: "#6c7a79", roughness: 0.95 }), [cD, cN]);
  const geo = useMemo(() => {
    const m = groundMesh(r), g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(m.col, 3)); g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }, [r]);
  const body = useMemo(() => {
    const m = rockMesh(r), g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.pos, 3)); g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }, [r]);
  useEffect(() => () => { grass.dispose(); rock.dispose(); geo.dispose(); body.dispose(); }, [grass, rock, geo, body]);
  return <group>
    <mesh geometry={geo} material={grass} receiveShadow />
    <mesh geometry={body} material={rock} receiveShadow castShadow />
  </group>;
}

const KIND_H = { spruce: 9.5, birch: 8, pine: 10.5 } as const;

/** Real trees (replace the low-poly ones), shrubs by the house, ferns, flowers and mossy rocks near the rim. */
export function RealPlants({ site, r }: { site: SiteLayout; r: number }) {
  const set = useMemo(() => {
    const y = (x: number, z: number, d = 0) => groundY(x, z, r) + d;
    const fp = site.footprint;
    return {
      trees: site.trees.map((t, i): Inst => ({ at: [t.x, y(t.x, t.z, -0.05), t.z], s: [1, KIND_H[t.kind as keyof typeof KIND_H] * t.s, 1], ry: i * 2.17 })),
      shrubs: [...site.shrubs.map((p, i): Inst => ({ at: [p.x, y(p.x, p.z, -0.05), p.z], s: [1, 0.9 * p.s, 1], ry: i * 1.9 })),
        ...rimSpots(r, 10, [0.78, 0.94], 9).map((p): Inst => ({ at: [p.x, y(p.x, p.z, -0.05), p.z], s: [1, 1.1 + p.k * 0.9, 1], ry: p.a * 3 }))],
      ferns: rimSpots(r, 24, [0.7, 0.93], 7).map((p): Inst => ({ at: [p.x, y(p.x, p.z), p.z], s: [1, 0.55 + p.k * 0.5, 1], ry: p.a * 5 })),
      rocks: rimSpots(r, 9, [0.9, 0.985], 5).map((p): Inst => ({ at: [p.x, y(p.x, p.z, -0.15), p.z], s: [1, 0.6 + p.k * 0.8, 1], ry: p.a * 7 })),
      flowers: meadowSpots(r, 55, fp, 2.5).map((p): Inst => ({ at: [p.x, y(p.x, p.z), p.z], s: [1, 0.3 + p.k * 0.15, 1], ry: p.k * 40 })),
    };
  }, [site, r]);
  return <>
    <AssetMany id="tree" items={set.trees} />
    <AssetMany id="shrub" items={set.shrubs} />
    <AssetMany id="fern" items={set.ferns} shadow={false} />
    <AssetMany id="rocks" items={set.rocks} />
    <AssetMany id="flower" items={set.flowers} shadow={false} />
  </>;
}
