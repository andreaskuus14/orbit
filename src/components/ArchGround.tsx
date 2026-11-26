"use client";
// ARCH site, tier 1+ (v11): the meadow. Real grass (CC0 Poly Haven texture, triplanar) on soft swells that run flat under the house and ease
// out to a far plane the haze swallows, so the ground has no visible edge. Real trees stand 20-46 m out, behind and beside the house and never
// in the camera's sector; bushes and ferns hug their trunks; wildflowers grow in patches on the lawn. One instanced draw call per part (AssetMany).
// The numbers are in lib/arch-ground-pure.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { farMesh, groundMesh, meadowHeight, silhouettes, treePlan, undergrowth, type TreeSpot } from "@/lib/arch-ground-pure";
import type { SiteLayout } from "@/lib/arch-mesh-pure";
import { shotSector } from "@/lib/arch-camera-pure";
import { AssetMany } from "./world-assets";
import { triplanarMaterial, useTex } from "./world-surfaces";
import type { Inst } from "./world-kit";

export const groundAt = (x: number, z: number, r: number) => { const a = Math.atan2(z, x), rho = Math.min(1, Math.hypot(x, z) / r); return meadowHeight(rho, a, r); };

export function RealGround({ r }: { r: number }) {
  const [gD, gN, cD, cN] = useTex("grassD", "grassN", "cliffD", "cliffN");
  const grass = useMemo(() => { const m = triplanarMaterial({ d: cD, n: cN, scale: 0.16 }, { d: gD, n: gN, scale: 0.34 }, { slope: 0.8, roughness: 0.96, normal: 0.8 }); m.vertexColors = true; return m; }, [gD, gN, cD, cN]);
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

export const KIND_H = { spruce: 9.5, birch: 8, pine: 10.5 } as const;
const treeInst = (t: TreeSpot, i: number, r: number): Inst => ({ at: [t.x, groundAt(t.x, t.z, r) - 0.05, t.z], s: [1, KIND_H[t.kind] * t.s, 1], ry: i * 2.17 });

/** Real trees behind and beside the house, bushes and ferns at their feet, shrubs by the house, a few mossy rocks. */
export function RealPlants({ site, r }: { site: SiteLayout; r: number }) {
  const set = useMemo(() => {
    const y = (x: number, z: number, d = 0) => groundAt(x, z, r) + d, fp = site.footprint, plan = treePlan(r, fp, shotSector()), under = undergrowth(plan.mid, 3);
    return {
      trees: plan.mid.map((t, i) => treeInst(t, i, r)),
      shrubs: [...site.shrubs.map((p, i): Inst => ({ at: [p.x, y(p.x, p.z, -0.05), p.z], s: [1, 0.8 * p.s, 1], ry: i * 1.9 })),
        ...under.filter((_, i) => i % 3 === 0).map((p): Inst => ({ at: [p.x, y(p.x, p.z, -0.05), p.z], s: [1, 0.9 + p.k * 0.8, 1], ry: p.k * 20 }))],
      ferns: under.filter((_, i) => i % 3 !== 0).map((p): Inst => ({ at: [p.x, y(p.x, p.z), p.z], s: [1, 0.45 + p.k * 0.35, 1], ry: p.k * 30 })),
      rocks: plan.mid.filter((_, i) => i % 3 === 0).map((t, i): Inst => ({ at: [t.x + 2.2, y(t.x + 2.2, t.z + 1, -0.12), t.z + 1], s: [1, 0.5 + (i % 3) * 0.25, 1], ry: i * 3 })),
    };
  }, [site, r]);
  return <>
    <AssetMany id="tree" items={set.trees} />
    <AssetMany id="shrub" items={set.shrubs} />
    <AssetMany id="fern" items={set.ferns} shadow={false} />
    <AssetMany id="rocks" items={set.rocks} />
  </>;
}

/** The forest edge: two rings of drawn tree silhouettes (cut-out, one draw call each) round the meadow, the second further out and paler, so the
 *  horizon is trees, not a ruled line. Cheap: no geometry beyond a cylinder, and the haze (fog) blends it. */
export function TreeLine({ r }: { r: number }) {
  const rings = useMemo(() => [{ seed: 1, rep: 4, rad: 0.9, h: 15, top: "#33463d", bot: "#16201c", rot: 0 }, { seed: 2, rep: 5, rad: 1.2, h: 26, top: "#65746f", bot: "#46544f", rot: 1.3 }].map((q) => {
    const W = 2048, H = 256, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const c = cv.getContext("2d")!, g = c.createLinearGradient(0, H * 0.05, 0, H); g.addColorStop(0, q.top); g.addColorStop(1, q.bot);
    c.fillStyle = g; c.fillRect(0, H * 0.93, W, H);
    silhouettes(44, q.seed).forEach((t) => { for (const dx of [0, -W]) {
      const x = t.x * W + dx, w = t.w * W, h = t.h * H * 0.93, base = H * 0.95;
      c.fillStyle = g; c.beginPath();
      if (t.conifer) { c.moveTo(x - w / 2, base); c.lineTo(x - w * 0.12, base - h * 0.2); for (let j = 0; j < 4; j++) { const yy = base - h * (0.2 + j * 0.2), ww = w * (0.5 - j * 0.1); c.lineTo(x - ww, yy); c.lineTo(x - ww * 0.4, yy - h * 0.08); }
        c.lineTo(x, base - h); for (let j = 3; j >= 0; j--) { const yy = base - h * (0.2 + j * 0.2), ww = w * (0.5 - j * 0.1); c.lineTo(x + ww * 0.4, yy - h * 0.08); c.lineTo(x + ww, yy); } c.lineTo(x + w * 0.12, base - h * 0.2); c.lineTo(x + w / 2, base); }
      else { c.ellipse(x, base - h * 0.6, w * 0.55, h * 0.36, 0, 0, Math.PI * 2); c.rect(x - w * 0.04, base - h * 0.3, w * 0.08, h * 0.3); }
      c.fill(); } });
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(q.rep, 1); tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
    return { ...q, mat: new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.BackSide, fog: true }), geo: new THREE.CylinderGeometry(1, 1, 1, 96, 1, true) };
  }), []);
  useEffect(() => () => rings.forEach((q) => { q.mat.map?.dispose(); q.mat.dispose(); q.geo.dispose(); }), [rings]);
  return <>{rings.map((q) => <mesh key={q.seed} geometry={q.geo} material={q.mat} position={[0, q.h / 2 - 1, 0]} scale={[r * q.rad, q.h, r * q.rad]} rotation={[0, q.rot, 0]} />)}</>;
}
