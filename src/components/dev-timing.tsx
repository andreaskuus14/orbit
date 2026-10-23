"use client";
import { useFrame } from "@react-three/fiber";

// Dev only: how long from opening a world (or returning to the galaxy) until its canvas draws a frame.
let pending: { name: string; t: number } | null = null;
export function markOpen(name: string) { if (process.env.NODE_ENV === "development") pending = { name, t: performance.now() }; }

/** Inside a <Canvas>: logs the first frame drawn after markOpen(name). */
export function FrameMark({ name, note }: { name: string; note?: string }) {
  useFrame(() => {
    if (pending?.name !== name) return;
    console.info(`[orbit] ${name}${note ? ` (${note})` : ""}: open → first frame ${Math.round(performance.now() - pending.t)} ms`);
    pending = null;
  });
  return null;
}
