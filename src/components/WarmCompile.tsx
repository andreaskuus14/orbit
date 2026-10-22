"use client";
// Entering a world froze the page for 130–320 ms (measured on the owner's PC): every world mounts a fresh WebGL context, so
// three compiles all its shaders inside the first render. This holds the render loop while compileAsync compiles them in
// parallel (KHR_parallel_shader_compile), so the main thread stays free; the world then starts drawing with shaders ready.
import { useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";

export function WarmCompile() {
  const { gl, scene, camera, setFrameloop, frameloop } = useThree();
  useLayoutEffect(() => {
    let alive = true;
    const prev = frameloop;
    setFrameloop("never");
    // one tick later: the world's children have mounted into the scene
    const t = setTimeout(() => {
      gl.compileAsync(scene, camera).catch(() => {}).finally(() => { if (alive) setFrameloop(prev); });
    }, 0);
    return () => { alive = false; clearTimeout(t); setFrameloop(prev); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per canvas
  }, []);
  return null;
}
