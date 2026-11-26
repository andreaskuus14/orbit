"use client";
// ARCH (the realistic look): lime dimension lines (width, depth, height set off from the house, with extension lines and end ticks) and their
// labels, measured from the model itself (worlds-v3-pure archFootprint, arch-dims-pure).
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { archFootprint, metres } from "@/lib/worlds-v3-pure";
import { dimLines } from "@/lib/arch-dims-pure";
import type { Chip } from "./world-kit";

export const LIME = "#b6f23a";
type P = { kind: string; x: number; y: number; z: number; w: number; d: number; h: number };

/** Dimension lines: width, depth and height set off from the house with extension lines and end ticks, plus a thin footprint outline. */
export function ArchDims({ parts, top }: { parts: P[]; top: number }) {
  const f = useMemo(() => archFootprint(parts), [parts]);
  const d = useMemo(() => (f ? dimLines(f, top) : null), [f, top]);
  if (!d) return null;
  const pts = (s: { a: [number, number, number]; b: [number, number, number] }) => [s.a, s.b] as [number, number, number][];
  return <group>
    <Line points={d.outline} color={LIME} lineWidth={1.4} transparent opacity={0.7} toneMapped={false} />
    {d.main.map((s, i) => <Line key={`m${i}`} points={pts(s)} color={LIME} lineWidth={1.9} toneMapped={false} />)}
    {d.ext.map((s, i) => <Line key={`e${i}`} points={pts(s)} color={LIME} lineWidth={1} transparent opacity={0.6} toneMapped={false} />)}
    {d.ticks.map((s, i) => <Line key={`t${i}`} points={pts(s)} color={LIME} lineWidth={2.2} toneMapped={false} />)}
  </group>;
}

/** The four labels, each on its own dimension line (width, depth, height) or just beyond it (floor area). */
export function archChips(parts: P[], top: number, area: string, _cost: string, k: (key: string) => string): Chip[] {
  const f = archFootprint(parts);
  if (!f) return [];
  const d = dimLines(f, top).at;
  return [
    { id: "w", at: d.w, title: k("w3.width"), value: metres(f.w), color: LIME, prio: 9, dim: true },
    { id: "d", at: d.d, title: k("w3.depth"), value: metres(f.d), color: LIME, prio: 8, dim: true },
    { id: "h", at: d.h, title: k("w3.height"), value: metres(top), color: LIME, prio: 7, dim: true },
    { id: "a", at: d.a, title: k("w3.area"), value: area, color: LIME, prio: 10, dim: true },
  ];
}

/** frameloop="demand": draw a few frames after mount so the chips get placed even before he touches the view. */
export function KickFrames({ ms = 1500 }: { ms?: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { const t0 = performance.now(); let id = 0; const tick = () => { invalidate(); if (performance.now() - t0 < ms) id = requestAnimationFrame(tick); }; id = requestAnimationFrame(tick); return () => cancelAnimationFrame(id); }, [invalidate, ms]);
  return null;
}
