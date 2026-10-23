"use client";
// The CORE as an alien megastructure: a white singularity (halo, photon ring) wrapped in a Matrioshka brain, four
// nested Dyson-swarm shells of mirror panels (Swarm). The tesseract rings, accretion disk and fractal lattice of the
// previous CORE are gone: the swarm replaces them (they read as clutter around it).
// All motion is uniforms on the GPU; every shader output is clamped finite and >= 0 (bloom NaN rule).
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HOLO } from "./env";
import { Swarm } from "./Swarm";
import { coreCalm, coreScale } from "@/lib/alien-pure";
import type { CoreLive } from "../ParticleCore";

const finite = (x: number, lo = 0, hi = 1) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);

/* ---------- halo: a camera-facing quad (white core, photon ring, slowly turning god rays) ---------- */
const HALO_VS = /* glsl */ `
uniform float uSize; varying vec2 vP;
void main() {
  vP = position.xy * 2.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize * (1.0 + max(-mv.z, 0.0) * 0.018); // grows with distance, like a lens flare: the artifact stays the anchor of the overview
  gl_Position = projectionMatrix * mv;
}`;
const HALO_FS = /* glsl */ `
uniform float uTime; uniform float uGain; uniform float uRays; varying vec2 vP;
${HOLO}
void main() {
  float r = length(vP), a = atan(vP.y, vP.x), t = uTime;
  float core = exp(-r * r * 2600.0) * 6.0 + exp(-r * 48.0) * 1.2 + exp(-r * 9.0) * 0.1; // precise, not a blown-out flare
  float ring = exp(-pow((r - 0.055) * 260.0, 2.0)) * 1.3;
  float rays = pow(0.5 + 0.5 * sin(a * 9.0 + sin(a * 4.0 - t * 0.21) * 1.8 + t * 0.05), 10.0)
             + 0.6 * pow(0.5 + 0.5 * sin(a * 23.0 - t * 0.09 + sin(a * 3.0 + t * 0.13) * 2.4), 18.0);
  rays *= exp(-r * 9.0) * (1.0 - smoothstep(0.3, 0.8, r)) * uRays * 0.1;
  vec3 c = vec3(1.0, 0.98, 0.95) * (core + ring) + mix(vec3(0.85, 0.92, 1.0), holo(a * 0.159 + r + t * 0.02), 0.2) * rays;
  gl_FragColor = vec4(clamp(c * uGain, 0.0, 4.0), 1.0);
}`;

export function Singularity({ live, reduced, level, busy = false, positions, pulses }: {
  live: RefObject<CoreLive>; reduced: boolean; level: number; busy?: boolean;
  positions?: Record<string, THREE.Vector3>; pulses?: RefObject<Record<string, number>>; // planet apertures and event waves in the swarm
}) {
  const halo = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: HALO_VS, fragmentShader: HALO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uGain: { value: 1 }, uRays: { value: 1 }, uSize: { value: 30 } },
  }), []);
  const quad = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const root = useRef<THREE.Group>(null);
  useEffect(() => () => { halo.dispose(); quad.dispose(); }, [halo, quad]);

  useFrame(({ clock, camera }) => {
    const t = reduced ? 12 : clock.elapsedTime, L = live.current, calm = coreCalm(camera.position.length());
    const g = finite(L?.g ?? 0), br = finite(L?.breath ?? 0.5), v = finite((L?.mic ?? 0) + (L?.spk ?? 0));
    halo.uniforms.uTime.value = t;
    halo.uniforms.uGain.value = (0.7 + 0.2 * br + 0.9 * g + 0.6 * v) * (1 - 0.7 * calm); // overview: the lens would gather it into a blob
    halo.uniforms.uRays.value = (level === 0 ? 0.5 : 1) * (1 - 0.97 * calm) * 0.7; // god rays are a close-up drama: none on the overview
    root.current?.scale.setScalar(coreScale(camera.position.length()));
  });

  return (
    <group ref={root}>
      <mesh geometry={quad} material={halo} frustumCulled={false} renderOrder={2} />
      <Swarm live={live} reduced={reduced} level={level} busy={busy} positions={positions} pulses={pulses} />
    </group>
  );
}
