"use client";
import { useCallback, useState } from "react";
import type { RootState } from "@react-three/fiber";
import { perfMark } from "./PerfBeacon";

/**
 * WebGL contexts get lost when a laptop sleeps or the GPU driver resets; three.js doesn't rebuild
 * the scene, so the canvas stays black. Remount the <Canvas> (bump its key) once the context is back.
 */
export function useGlRecovery() {
  const [key, setKey] = useState(0);
  const onCreated = useCallback(({ gl }: RootState) => {
    const el = gl.domElement;
    // perf log: a lost context remounts the canvas and recompiles everything (a second warm-compiled), so say when it happens
    const n = () => ({ canvases: document.querySelectorAll("canvas").length });
    el.addEventListener("webglcontextlost", (e) => { e.preventDefault(); perfMark("gl-lost", n()); }, { once: true }); // allow a restore
    el.addEventListener("webglcontextrestored", () => { perfMark("gl-restored", n()); setKey((k) => k + 1); }, { once: true });
  }, []);
  return { key, onCreated };
}
