"use client";
// Alien theme, shared bits: the holographic palette, and a procedural reflection map for the liquid-metal and obsidian
// surfaces (black void + thin iridescent light slits, baked once through PMREM). No image assets.
import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

/** Holographic palette: cyan -> violet -> rose, like a soap film on deep black. Output is always in [0, 1]. */
export const HOLO = /* glsl */ `
vec3 holo(float x) {
  float a = 0.5 + 0.5 * sin(6.2831853 * x), b = 0.5 + 0.5 * sin(3.1415927 * x + 1.7);
  return mix(mix(vec3(0.1, 0.72, 1.0), vec3(0.48, 0.22, 1.0), a), vec3(1.0, 0.28, 0.66), b * b * 0.75);
}
`;

const ENV_FS = /* glsl */ `
varying vec3 vD;
${HOLO}
void main() {
  vec3 d = normalize(vD);
  float a = atan(d.z, d.x);
  vec3 c = vec3(0.01, 0.012, 0.02) + vec3(0.10, 0.12, 0.18) * pow(max(d.y, 0.0), 0.7); // cold dome: liquid metal needs something to mirror
  c += mix(vec3(1.0), holo(a * 0.32 + 0.1), 0.35) * exp(-pow(d.y * 9.0, 2.0)) * 1.3;                    // iridescent horizon band
  c += vec3(2.4) * exp(-pow((d.y - 0.55) * 26.0, 2.0)) * smoothstep(0.2, 0.9, cos(a - 0.6)); // long top softbox
  c += holo(0.62) * 2.2 * exp(-pow((a - 2.3) * 9.0, 2.0)) * smoothstep(0.9, 0.0, abs(d.y - 0.1)); // vertical slit
  c += holo(0.12) * 1.8 * exp(-pow((a + 1.6) * 11.0, 2.0)) * smoothstep(0.8, 0.0, abs(d.y + 0.15));
  c += vec3(0.25, 0.35, 0.6) * pow(max(-d.y, 0.0), 3.0) * 0.4;                    // underglow
  gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
}`;

function bake(gl: THREE.WebGLRenderer) {
  const pm = new THREE.PMREMGenerator(gl);
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 64, 32);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, fragmentShader: ENV_FS,
    vertexShader: "varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  });
  scene.add(new THREE.Mesh(geo, mat));
  const rt = pm.fromScene(scene, 0.015);
  geo.dispose(); mat.dispose(); pm.dispose();
  return rt;
}

// One bake per renderer, shared by every surface that reflects it; disposed when the last user unmounts.
const cache = new WeakMap<THREE.WebGLRenderer, { rt: THREE.WebGLRenderTarget; n: number }>();
export function useAlienEnv() {
  const gl = useThree((s) => s.gl);
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let e = cache.get(gl);
    if (!e) { e = { rt: bake(gl), n: 0 }; cache.set(gl, e); }
    const entry = e;
    entry.n++;
    setTex(entry.rt.texture);
    return () => { if (--entry.n === 0) { entry.rt.dispose(); cache.delete(gl); } };
  }, [gl]);
  return tex;
}
