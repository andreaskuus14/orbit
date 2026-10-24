"use client";
// SPIKE (roadmap wave 1 "never stutters"): one shared WebGL canvas for the galaxy + STUDIO.
// Off unless localStorage["orbit.oneCanvas"] === "1". Today every world mounts its own <Canvas>, so each entry creates
// a WebGL context, a fresh EffectComposer and recompiles every shader (100–300 ms hitch). With the flag on, STUDIO hands
// its 3D scene to the galaxy's (already warm, kept-mounted) canvas instead:
//   StudioWorld (DOM) --<StageIn>--> module slot --<StageOut>--> inside Galaxy's <Canvas> --> <WorldScene> portal
// The portal gets its own THREE.Scene + camera, so the world's OrbitControls (makeDefault), raycasting, StudioCamera and
// its own EffectComposer all resolve to the world's scene/camera through useThree. Galaxy disables its composer and
// controls while a world is staged, so exactly one post-processing chain renders per frame.
import { useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { getSlot, subscribe } from "./stage-slot";
import * as THREE from "three";
import { createPortal, useThree } from "@react-three/fiber";

export { oneCanvasOn, StageIn, useStageActive } from "./stage-slot";

/** Inside the galaxy's <Canvas>: renders the staged world. Galaxy objects stop taking pointer hits meanwhile
 *  (three's raycaster skips objects whose layers don't match), so a click on a moon can't open a hidden planet. */
export function StageOut() {
  const node = useSyncExternalStore(subscribe, getSlot, () => null);
  const raycaster = useThree((s) => s.raycaster);
  const on = node !== null;
  useLayoutEffect(() => {
    if (!on) return;
    raycaster.layers.disableAll();
    return () => { raycaster.layers.set(0); };
  }, [on, raycaster]);
  return <>{node}</>;
}

/** A world's own scene + perspective camera inside the shared canvas. Mirrors <Canvas camera={{ position, fov }}>. */
export function WorldScene({ children, fov, position }: { children: ReactNode; fov: number; position: [number, number, number] }) {
  const [scene] = useState(() => new THREE.Scene());
  const [camera] = useState(() => {
    const c = new THREE.PerspectiveCamera(fov, 1, 0.1, 1000);
    c.position.set(...position);
    c.lookAt(0, 0, 0);
    return c;
  });
  const size = useThree((s) => s.size);
  // R3F only keeps the root camera's aspect in sync; this one is ours.
  useLayoutEffect(() => { camera.aspect = size.width / Math.max(1, size.height); camera.updateProjectionMatrix(); }, [camera, size]);
  return createPortal(children, scene, { camera });
}
