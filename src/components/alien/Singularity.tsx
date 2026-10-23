"use client";
// The CORE as an alien artifact: a white singularity with god rays and a photon ring, an accretion disk of light trails,
// and monolithic obsidian rings precessing on their own axes, etched with faint glyphs that light in sweeping waves.
// All motion is uniforms on the GPU plus four group rotations; every shader output is clamped finite and >= 0 (bloom NaN rule).
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HOLO, useAlienEnv } from "./env";
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
  float core = exp(-r * r * 2600.0) * 6.0 + exp(-r * 40.0) * 1.6 + exp(-r * 9.0) * 0.3;
  float ring = exp(-pow((r - 0.055) * 260.0, 2.0)) * 1.3;
  float rays = pow(0.5 + 0.5 * sin(a * 9.0 + sin(a * 4.0 - t * 0.21) * 1.8 + t * 0.05), 10.0)
             + 0.6 * pow(0.5 + 0.5 * sin(a * 23.0 - t * 0.09 + sin(a * 3.0 + t * 0.13) * 2.4), 18.0);
  rays *= exp(-r * 7.0) * (1.0 - smoothstep(0.4, 1.0, r)) * uRays * 0.24;
  vec3 c = vec3(1.0, 0.98, 0.95) * (core + ring) + mix(vec3(0.85, 0.92, 1.0), holo(a * 0.159 + r + t * 0.02), 0.2) * rays;
  gl_FragColor = vec4(clamp(c * uGain, 0.0, 12.0), 1.0);
}`;

/* ---------- accretion disk: polar light trails, faster near the centre (Kepler-ish) ---------- */
const DISK_VS = /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DISK_FS = /* glsl */ `
uniform float uTime; uniform float uGain; uniform float uIn; uniform float uOut; varying vec2 vP;
${HOLO}
void main() {
  float r = max(length(vP), 1e-3), a = atan(vP.y, vP.x), t = uTime, lr = log(r);
  float w = t * 1.6 / (r * sqrt(r));
  float s1 = pow(0.5 + 0.5 * sin(a * 3.0 - w + lr * 11.0 + sin(a * 2.0 + t * 0.4) * 0.6), 7.0);
  float s2 = pow(0.5 + 0.5 * sin(a * 7.0 - w * 1.3 + lr * 23.0), 14.0);
  float s3 = pow(0.5 + 0.5 * sin(a * 13.0 - w * 0.8 - lr * 5.0), 20.0);
  float x = (r - uIn) / (uOut - uIn);
  float fall = smoothstep(0.0, 0.08, x) * pow(max(1.0 - x, 0.0), 1.6);
  vec3 hot = vec3(1.0, 0.96, 0.9) * 2.2, cool = holo(x * 0.9 + a * 0.08 + 0.45) * 1.1;
  vec3 c = mix(hot, cool, smoothstep(0.0, 0.55, x)) * (0.12 + s1 * 0.9 + s2 * 0.6 + s3 * 0.8) * fall;
  gl_FragColor = vec4(clamp(c * uGain, 0.0, 8.0), 1.0);
}`;

/* ---------- obsidian rings: physical material + glyph emission injected ---------- */
const RINGS = [ // radius, blade height, tilt, spin axis speed, precession speed
  { r: 2.15, h: 0.07, tilt: [1.1, 0.2, 0], spin: 0.21, pre: 0.05 },
  { r: 2.7, h: 0.11, tilt: [-0.5, 0.9, 0.3], spin: -0.13, pre: -0.035 },
  { r: 3.25, h: 0.09, tilt: [0.25, -0.4, 1.2], spin: 0.09, pre: 0.025 },
  { r: 3.8, h: 0.15, tilt: [1.57, 0, 0.15], spin: -0.05, pre: 0.018 },
] as const;

function glyphHook(u: { uTime: { value: number }; uGlyph: { value: number } }) {
  return (s: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace("void main() {", "varying vec2 vG;\nvoid main() {\nvG = uv;");
    s.fragmentShader = s.fragmentShader
      .replace("void main() {", `varying vec2 vG; uniform float uTime; uniform float uGlyph;
        float gh(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 43758.5453); }
        void main() {`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        { // a band of 3x5-dot glyphs along each blade face; a slow wave lights them column by column
          vec2 g = vec2(vG.x * 380.0, fract(vG.y * 4.0));
          vec2 cell = floor(g); vec2 f = fract(g);
          vec2 sub = floor(vec2(f.x * 4.0, (g.y - 0.38) / 0.24 * 6.0));
          float inBand = step(0.38, g.y) * step(g.y, 0.62) * step(sub.x, 2.0) * step(0.0, sub.y) * step(sub.y, 4.0);
          float word = floor(cell.x / 7.0), face = floor(vG.y * 4.0);
          float lit = step(0.5, gh(cell * 7.1 + sub + face * 13.0)) * inBand * step(mod(cell.x, 7.0), 5.5) * step(0.5, gh(vec2(word, face)));
          float wave = pow(0.5 + 0.5 * sin(vG.x * 6.2831853 * 3.0 - uTime * 0.7 + gh(cell) * 0.6), 14.0);
          totalEmissiveRadiance += vec3(0.55, 0.85, 1.0) * lit * (0.04 + 1.6 * wave) * max(uGlyph, 0.0);
        }`);
  };
}

function ObsidianRing({ r, h, env, u }: { r: number; h: number; env: THREE.Texture | null; u: Parameters<typeof glyphHook>[0] }) {
  const geo = useMemo(() => new THREE.TorusGeometry(r, h, 4, 220), [r, h]); // 4 tube sides: a faceted, monolithic blade
  const mat = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      color: "#030305", metalness: 0.9, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.03,
      iridescence: 0.3, iridescenceIOR: 1.5, iridescenceThicknessRange: [180, 520], flatShading: true, envMapIntensity: 0.45, // obsidian: a dark mirror, mostly clearcoat glints
    });
    m.onBeforeCompile = glyphHook(u);
    return m;
  }, [u]);
  useEffect(() => { mat.envMap = env; mat.needsUpdate = true; }, [mat, env]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} scale={[1, 1, 3.2]} />; // stretched along the tube's z: tall thin blade
}

export function Singularity({ live, reduced, level }: { live: RefObject<CoreLive>; reduced: boolean; level: number }) {
  const env = useAlienEnv();
  const halo = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: HALO_VS, fragmentShader: HALO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uGain: { value: 1 }, uRays: { value: 1 }, uSize: { value: 30 } },
  }), []);
  const disk = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: DISK_VS, fragmentShader: DISK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uGain: { value: 1 }, uIn: { value: 0.45 }, uOut: { value: 2.9 } },
  }), []);
  const diskGeo = useMemo(() => new THREE.RingGeometry(0.45, 2.9, 160, 6), []);
  const quad = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const glyph = useMemo(() => ({ uTime: { value: 0 }, uGlyph: { value: 1 } }), []);
  useEffect(() => () => { halo.dispose(); disk.dispose(); diskGeo.dispose(); quad.dispose(); }, [halo, disk, diskGeo, quad]);

  const rings = useRef<(THREE.Group | null)[]>([]);
  const spin = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ clock }, dt) => {
    const t = reduced ? 12 : clock.elapsedTime, L = live.current;
    const g = finite(L?.g ?? 0), br = finite(L?.breath ?? 0.5), v = finite((L?.mic ?? 0) + (L?.spk ?? 0));
    halo.uniforms.uTime.value = t;
    halo.uniforms.uGain.value = 0.85 + 0.25 * br + 0.9 * g + 0.6 * v;
    halo.uniforms.uRays.value = level === 0 ? 0.5 : 1;
    disk.uniforms.uTime.value = t;
    disk.uniforms.uGain.value = 0.9 + 0.2 * br + 0.8 * g + 0.5 * v;
    glyph.uTime.value = t;
    glyph.uGlyph.value = 0.8 + 1.5 * g + 0.8 * v;
    if (reduced) return;
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    for (let i = 0; i < RINGS.length; i++) { // spin about the blade's own axis, precess the whole ring around y
      const s = spin.current[i], o = rings.current[i];
      if (s) s.rotation.z += step * RINGS[i].spin * (1 + 2 * g);
      if (o) o.rotation.y += step * RINGS[i].pre;
    }
  });

  return (
    <group>
      <mesh geometry={quad} material={halo} frustumCulled={false} renderOrder={2} />
      <mesh geometry={diskGeo} material={disk} rotation={[-Math.PI / 2 + 0.32, 0, 0.12]} />
      {RINGS.map((k, i) => (
        <group key={i} ref={(el) => { rings.current[i] = el; }}>
          <group rotation={k.tilt as unknown as [number, number, number]}>
            <group ref={(el) => { spin.current[i] = el; }}>
              <ObsidianRing r={k.r} h={k.h} env={env} u={glyph} />
            </group>
          </group>
        </group>
      ))}
    </group>
  );
}
