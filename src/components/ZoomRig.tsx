"use client";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";

/** Inside a world's <Canvas> with OrbitControls: eases the camera distance on "zoom in / out / reset the view" commands.
 *  Only the canvas on screen is mounted, so the command lands in the open world. home = the world's starting distance. */
export function ZoomRig({ home, reduced }: { home: number; reduced: boolean }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; minDistance: number; maxDistance: number } | null;
  const goal = useRef<number | null>(null);

  useEffect(() => {
    const h = (e: Event) => {
      const z = (e as CustomEvent<NavTarget>).detail.zoom;
      if (!z || !controls) return;
      const d = goal.current ?? camera.position.distanceTo(controls.target); // "zoom in more" during a zoom keeps going
      goal.current = THREE.MathUtils.clamp(z === "in" ? d * 0.65 : z === "out" ? d * 1.5 : home, controls.minDistance, controls.maxDistance);
    };
    addEventListener(NAV_EVENT, h);
    return () => removeEventListener(NAV_EVENT, h);
  }, [camera, controls, home]);

  const off = useRef(new THREE.Vector3());
  useFrame((_, dt) => {
    if (goal.current === null || !controls) return;
    const o = off.current.copy(camera.position).sub(controls.target);
    const d = o.length();
    const next = reduced ? goal.current : THREE.MathUtils.damp(d, goal.current, 7, dt);
    camera.position.copy(controls.target).addScaledVector(o, next / d);
    if (Math.abs(next - goal.current) < 0.005 * goal.current) goal.current = null;
  });
  return null;
}
