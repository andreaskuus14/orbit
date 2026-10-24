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
      // Hidden parts (LOD layers, micro-worlds, orbitals) would otherwise compile synchronously the moment they first
      // show, freezing a planet switch: make them visible for the compile only (nothing draws: the loop is held).
      const hidden: { visible: boolean }[] = [];
      scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      // compileAsync collects programs synchronously on call, so the hidden parts are restored at once. Restoring them
      // later re-hid anything the app had made visible meanwhile (the INTELLIGENCE globe stayed invisible).
      const p = gl.compileAsync(scene, camera);
      hidden.forEach((o) => { o.visible = false; });
      p.catch(() => {}).finally(() => { if (alive) setFrameloop(prev); });
    }, 0);
    return () => { alive = false; clearTimeout(t); setFrameloop(prev); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per canvas
  }, []);
  return null;
}
