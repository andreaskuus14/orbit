"use client";
import { useFrame } from "@react-three/fiber";
import { clearMark, pending } from "./dev-mark";
export { markOpen } from "./dev-mark";

// Dev only: how long from opening a world (or returning to the galaxy) until its canvas draws a frame.

/** Inside a <Canvas>: logs the first frame drawn after markOpen(name). */
export function FrameMark({ name, note }: { name: string; note?: string }) {
  useFrame(() => {
    if (pending?.name !== name) return;
    console.info(`[orbit] ${name}${note ? ` (${note})` : ""}: open → first frame ${Math.round(performance.now() - pending.t)} ms`);
    clearMark();
  });
  return null;
}
