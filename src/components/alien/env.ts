"use client";
// Alien theme, shared bits: the holographic palette, and a procedural reflection map for the liquid-metal and obsidian
// surfaces (black void + thin iridescent light slits, baked once through PMREM). No image assets.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { compileAs } from "../WarmCompile";

/** Holographic palette: cyan -> violet -> rose, like a soap film on deep black. Output is always in [0, 1]. */
export const HOLO = /* glsl */ `
vec3 holo(float x) {
  float a = 0.5 + 0.5 * sin(6.2831853 * x), b = 0.5 + 0.5 * sin(3.1415927 * x + 1.7);
  return mix(mix(vec3(0.1, 0.72, 1.0), vec3(0.48, 0.22, 1.0), a), vec3(1.0, 0.28, 0.66), b * b * 0.75);
}
`;

/** The reflection map's sky in direction `d` (before PMREM's blur). Also the stand-ins' fake reflection (needs HOLO). */
export const ENV_SKY = /* glsl */ `
vec3 envSky(vec3 d) {
  float a = atan(d.z, d.x);
  vec3 c = vec3(0.01, 0.012, 0.02) + vec3(0.10, 0.12, 0.18) * pow(max(d.y, 0.0), 0.7); // cold dome: liquid metal needs something to mirror
  c += mix(vec3(1.0), holo(a * 0.32 + 0.1), 0.35) * exp(-pow(d.y * 9.0, 2.0)) * 1.3;                    // iridescent horizon band
  c += vec3(2.4) * exp(-pow((d.y - 0.55) * 26.0, 2.0)) * smoothstep(0.2, 0.9, cos(a - 0.6)); // long top softbox
  c += holo(0.62) * 2.2 * exp(-pow((a - 2.3) * 9.0, 2.0)) * smoothstep(0.9, 0.0, abs(d.y - 0.1)); // vertical slit
  c += holo(0.12) * 1.8 * exp(-pow((a + 1.6) * 11.0, 2.0)) * smoothstep(0.8, 0.0, abs(d.y + 0.15));
  c += vec3(0.25, 0.35, 0.6) * pow(max(-d.y, 0.0), 3.0) * 0.4;                    // underglow
  return max(c, vec3(0.0));
}`;
const ENV_FS = /* glsl */ `
varying vec3 vD;
${HOLO}
${ENV_SKY}
void main() { gl_FragColor = vec4(envSky(normalize(vD)), 1.0); }`;

type PmremInternals = { _setSize?: (n: number) => void; _allocateTargets?: () => THREE.WebGLRenderTarget; _blurMaterial?: THREE.Material | null; _lodPlanes?: THREE.BufferGeometry[] };

/** Bakes the reflection map. Its three shaders (this sky, PMREM's blur, PMREM's background box) used to compile
 *  synchronously inside the bake: they now compile in parallel first, so the bake itself is only a few draws. */
async function bake(gl: THREE.WebGLRenderer) {
  const pm = new THREE.PMREMGenerator(gl);
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 64, 32);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, fragmentShader: ENV_FS,
    vertexShader: "varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  });
  scene.add(new THREE.Mesh(geo, mat));
  const box = new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false }); // = PMREM's background box
  const warm = new THREE.Scene().add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo, box));
  // shortcut: reaches into three r180's PMREMGenerator to create its blur material early (same size as fromScene's
  // default 256); if a three upgrade renames these, the blur shader just compiles synchronously again.
  const p = pm as unknown as PmremInternals;
  if (p._setSize && p._allocateTargets) {
    p._setSize(256); p._allocateTargets().dispose();
    if (p._blurMaterial && p._lodPlanes?.[0]) warm.add(new THREE.Mesh(p._lodPlanes[0], p._blurMaterial));
  }
  try {
    await compileAs(gl, warm, new THREE.PerspectiveCamera(), true); // PMREM draws into render targets
    return pm.fromScene(scene, 0.015);
  } finally { geo.dispose(); mat.dispose(); box.dispose(); pm.dispose(); }
}

// One bake per renderer, shared by every surface that reflects it; disposed when the last user unmounts.
type Entry = { tex: THREE.Texture | null; rt: THREE.WebGLRenderTarget | null; n: number; dead: boolean; ready: Promise<void>; subs: Set<() => void> };
const cache = new WeakMap<THREE.WebGLRenderer, Entry>();
function entry(gl: THREE.WebGLRenderer) {
  let e = cache.get(gl);
  if (e) return e;
  const made: Entry = { tex: null, rt: null, n: 0, dead: false, ready: Promise.resolve(), subs: new Set() };
  made.ready = bake(gl).then((rt) => {
    if (made.dead) { rt.dispose(); return; }
    made.rt = rt; made.tex = rt.texture;
    made.subs.forEach((f) => f()); // a store update: users re-render (and apply it) synchronously, before WarmCompile resumes
  }, () => {});
  cache.set(gl, made);
  return made;
}
/** Settles when this canvas's reflection map is baked (null: nothing on it uses one). WarmCompile waits for it, so the
 *  env-mapped programs are compiled before the first frame instead of synchronously when the map arrives. */
export function envReady(gl: THREE.WebGLRenderer) { return cache.get(gl)?.ready ?? null; }

export function useAlienEnv() {
  const gl = useThree((s) => s.gl);
  const e = useMemo(() => entry(gl), [gl]);
  const sub = useCallback((f: () => void) => { e.subs.add(f); return () => { e.subs.delete(f); }; }, [e]);
  const tex = useSyncExternalStore(sub, () => e.tex, () => null);
  useEffect(() => {
    e.n++;
    return () => { // a beat later: a remount (dev StrictMode, a quick re-entry) keeps the bake
      e.n--;
      setTimeout(() => { if (e.n === 0 && !e.dead) { e.dead = true; e.rt?.dispose(); if (cache.get(gl) === e) cache.delete(gl); } }, 0);
    };
  }, [gl, e]);
  return tex;
}
