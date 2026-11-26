"use client";
// ARCH v3 (the realistic look): the plot as a cliff-top island over a fjord, mountains round it, and lime dimension lines and tags
// measured from the model itself (worlds-v3-pure archFootprint). Few draw calls: one rock, one water plane, instanced mountains.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { archFootprint, metres, rng } from "@/lib/worlds-v3-pure";
import type { Chip, Inst } from "./world-kit";
import { AssetEnv, AssetMany, RealOr } from "./world-assets";

export const LIME = "#b6f23a";
type P = { kind: string; x: number; y: number; z: number; w: number; d: number; h: number };

/** Rock under the lawn disc (radius r), the fjord far below, a ring of snow-capped mountains. */
export function ArchCliff({ r }: { r: number }) {
  const rock = useMemo(() => { const g = new THREE.CylinderGeometry(r, r * 0.55, r * 0.7, 28, 4, true); g.translate(0, -r * 0.35 - 0.02, 0);
    const p = g.attributes.position, rand = rng(13);
    for (let i = 0; i < p.count; i++) { const top = p.getY(i) > -0.1; const k = top ? 1 : 0.85 + rand() * 0.3; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    g.computeVertexNormals(); return g.toNonIndexed(); }, [r]);
  const peaks = useRef<THREE.InstancedMesh>(null), snow = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => { const rand = rng(41); return Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2 + rand() * 0.3, d = r * 8 + rand() * r * 3, h = r * (0.55 + rand() * 0.6);
    return { x: Math.cos(a) * d, z: Math.sin(a) * d, h, w: h * (1.3 + rand() * 0.6) }; }); }, [r]);
  useLayoutEffect(() => { const o = new THREE.Object3D();
    spots.forEach((s, i) => { o.position.set(s.x, -r * 0.9 + s.h / 2, s.z); o.scale.set(s.w, s.h, s.w); o.rotation.set(0, i, 0); o.updateMatrix(); peaks.current?.setMatrixAt(i, o.matrix);
      o.position.set(s.x, -r * 0.9 + s.h * 0.86, s.z); o.scale.set(s.w * 0.29, s.h * 0.28, s.w * 0.29); o.updateMatrix(); snow.current?.setMatrixAt(i, o.matrix); });
    for (const m of [peaks.current, snow.current]) if (m) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); } }, [spots, r]);
  useEffect(() => () => rock.dispose(), [rock]);
  // v5: scanned coastal cliffs (Poly Haven, CC0) round the plot and as the mountain ring; the cones stay for the low tier.
  const real = useMemo(() => ({
    walls: Array.from({ length: 7 }, (_, i): Inst => { const a = (i / 7) * Math.PI * 2; return { at: [Math.cos(a) * r * 0.9, -r * 0.8, Math.sin(a) * r * 0.9], s: [r * 1.15, r * 0.74, r * 0.5], ry: -a + Math.PI / 2 }; }),
    peaks: spots.map((p, i): Inst => ({ at: [p.x, -r * 1.6, p.z], s: [p.w * 1.8, p.h * 1.9, p.w * 0.9], ry: -Math.atan2(p.z, p.x) + Math.PI / 2 + (i % 2 ? 0.3 : -0.3) })),
  }), [spots, r]);
  return <group>
    <mesh geometry={rock} castShadow receiveShadow><meshStandardMaterial color="#4d4640" roughness={0.95} flatShading side={THREE.DoubleSide} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position={[0, -r * 0.9, 0]}><circleGeometry args={[r * 12, 64]} /><meshStandardMaterial color="#20384a" metalness={0.6} roughness={0.12} /></mesh>
    <RealOr fallback={<>
      <instancedMesh ref={peaks} args={[undefined, undefined, spots.length]}><coneGeometry args={[0.5, 1, 7]} /><meshStandardMaterial color="#3c4450" roughness={0.9} flatShading /></instancedMesh>
      <instancedMesh ref={snow} args={[undefined, undefined, spots.length]}><coneGeometry args={[0.5, 1, 7]} /><meshStandardMaterial color="#eef2f6" roughness={0.7} flatShading /></instancedMesh>
    </>}>
      <AssetMany id="cliff" items={real.walls} uniform={false} />
      <AssetMany id="cliff" items={real.peaks} uniform={false} shadow={false} />
      <AssetEnv id="hdriDay" intensity={0.5} />
    </RealOr>
  </group>;
}

/** Lime footprint outline and corner posts up to the top of the house. */
export function ArchDims({ parts, top }: { parts: P[]; top: number }) {
  const f = useMemo(() => archFootprint(parts), [parts]);
  if (!f) return null;
  const y = 0.06, c: [number, number, number][] = [[f.x0, y, f.z0], [f.x1, y, f.z0], [f.x1, y, f.z1], [f.x0, y, f.z1], [f.x0, y, f.z0]];
  return <group>
    <Line points={c} color={LIME} lineWidth={2.2} toneMapped={false} />
    {c.slice(0, 4).map(([x, , z], i) => <Line key={i} points={[[x, y, z], [x, top, z]]} color={LIME} lineWidth={1} transparent opacity={0.55} dashed dashSize={0.3} gapSize={0.2} toneMapped={false} />)}
  </group>;
}

export function archChips(parts: P[], top: number, area: string, cost: string, k: (key: string) => string): Chip[] {
  const f = archFootprint(parts);
  if (!f) return [];
  return [
    { id: "w", at: [(f.x0 + f.x1) / 2, 0.1, f.z1], title: k("w3.width"), value: metres(f.w), color: LIME, prio: 9 },
    { id: "d", at: [f.x1, 0.1, (f.z0 + f.z1) / 2], title: k("w3.depth"), value: metres(f.d), color: LIME, prio: 8 },
    { id: "h", at: [f.x0, top * 0.6, f.z1], title: k("w3.height"), value: metres(top), color: LIME, prio: 7 },
    { id: "a", at: [(f.x0 + f.x1) / 2, top + 1, (f.z0 + f.z1) / 2], title: k("w3.area"), value: area, sub: `${k("w3.cost")} ${cost}`, color: LIME, prio: 10 },
  ];
}

/** frameloop="demand": draw a few frames after mount so the chips get placed even before he touches the view. */
export function KickFrames({ ms = 1500 }: { ms?: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { const t0 = performance.now(); let id = 0; const tick = () => { invalidate(); if (performance.now() - t0 < ms) id = requestAnimationFrame(tick); }; id = requestAnimationFrame(tick); return () => cancelAnimationFrame(id); }, [invalidate, ms]);
  return null;
}
