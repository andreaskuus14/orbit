"use client";
// Worlds as levitating liquid metal: chrome or obsidian with a soap-film sheen, reflecting the alien environment,
// their surface slowly rippling (vertex wobble + normal ripples, both on the GPU), each wrapped in a shell of firing
// thought-particles. Every shader term is bounded (bloom NaN rule).
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HOLO, useAlienEnv } from "./env";

/** The planet's surface material. `extra` is chained (the HUD's rim light). Returns the material; animate `uTime`. */
export function useLiquidMetal(color: string, obsidian: boolean, size: number, extra?: (s: THREE.WebGLProgramParametersWithUniforms) => void) {
  const env = useAlienEnv();
  const { mat, u } = useMemo(() => {
    const u = { uTime: { value: 0 }, uLq: { value: size } };
    const tint = new THREE.Color(color);
    const mat = new THREE.MeshPhysicalMaterial({
      color: obsidian ? tint.clone().multiplyScalar(0.07) : tint.clone().lerp(new THREE.Color("#ffffff"), 0.62),
      metalness: 1, roughness: obsidian ? 0.16 : 0.07, clearcoat: obsidian ? 1 : 0.4, clearcoatRoughness: 0.05,
      iridescence: obsidian ? 0.6 : 0.25, iridescenceIOR: 1.45, iridescenceThicknessRange: [150, 600],
      emissive: color, emissiveIntensity: 0, envMapIntensity: obsidian ? 2.2 : 1.5,
    });
    mat.onBeforeCompile = (s) => {
      extra?.(s);
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader
        .replace("void main() {", "uniform float uTime; uniform float uLq; varying vec3 vLq;\nvoid main() {")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vLq = position / max(uLq, 1e-3);
          transformed += objectNormal * uLq * 0.018 * (sin(vLq.x * 5.0 + uTime * 0.9) * sin(vLq.y * 4.0 - uTime * 0.7) + sin(vLq.z * 6.0 + uTime * 1.1) * 0.6);`);
      s.fragmentShader = s.fragmentShader
        .replace("void main() {", `uniform float uTime; varying vec3 vLq;\n${HOLO}\nvoid main() {`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
          { vec3 q = vLq * 3.2; float t = uTime * 0.55;
            vec3 w = vec3(sin(q.y * 2.1 + t) + sin(q.z * 3.3 - t * 1.3), sin(q.z * 2.4 + t * 1.1) + sin(q.x * 3.1 + t * 0.7), sin(q.x * 2.2 - t * 0.9) + sin(q.y * 2.9 + t * 1.2));
            normal = normalize(normal + w * 0.045); }`)
        .replace("#include <opaque_fragment>", `#include <opaque_fragment>
          { float f = 1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
            gl_FragColor.rgb += holo(f * 0.8 + vLq.y * 0.15 + uTime * 0.02) * pow(f, 3.0) * 0.35; }`); // thin-film edge sheen
    };
    return { mat, u };
  }, [color, obsidian, size, extra]);
  useEffect(() => { mat.envMap = env; mat.needsUpdate = true; }, [mat, env]);
  useEffect(() => () => mat.dispose(), [mat]);
  return { mat, u };
}

/* ---------- thought cluster: a shell of synapse points, dense at the surface, thinning outward ---------- */
const VS = /* glsl */ `
attribute float aSeed; uniform float uTime; uniform float uScale; uniform float uR; uniform float uGlow; uniform vec3 uColor;
varying vec3 vC; varying float vA;
${HOLO}
vec3 rot(vec3 p, vec3 k, float a) { float c = cos(a), s = sin(a); return p * c + cross(k, p) * s + k * dot(k, p) * (1.0 - c); }
void main() {
  vec3 k = normalize(vec3(sin(aSeed * 31.0), 1.6, cos(aSeed * 17.0)));
  vec3 d = rot(position, k, uTime * (0.12 + aSeed * 0.3) * (aSeed > 0.5 ? 1.0 : -1.0));
  float s = fract(aSeed * 97.31);
  float r = uR * (1.12 + 0.85 * s * s * s + 0.04 * sin(uTime * 2.0 + aSeed * 40.0));
  vec4 mv = modelViewMatrix * vec4(d * r, 1.0);
  float z = max(-mv.z, 0.1);
  float fire = pow(max(sin(uTime * (0.8 + aSeed) + aSeed * 61.0), 0.0), 16.0);
  vA = (0.45 + 1.4 * fire + 0.8 * uGlow) * (1.0 - s * 0.6) * smoothstep(1.5, 5.0, z);
  vC = mix(uColor, holo(aSeed + uTime * 0.03), 0.35);
  vC = mix(vC, vec3(1.0), fire * 0.5);
  gl_PointSize = clamp(uScale * (0.6 + 1.5 * fire) / z, 1.0, 8.0);
  gl_Position = projectionMatrix * mv;
}`;
const FS = /* glsl */ `varying vec3 vC; varying float vA;
void main(){ vec2 d = gl_PointCoord - 0.5; float a = max(1.0 - dot(d, d) * 4.0, 0.0);
  gl_FragColor = vec4(clamp(vC, 0.0, 1.0) * 2.0, clamp(a * a * vA, 0.0, 1.0)); }`;

export function ThoughtShell({ size, color, count, reduced, glow }: { size: number; color: string; count: number; reduced: boolean; glow: () => number }) {
  const geo = useMemo(() => {
    const r = Math.random;
    const p = new Float32Array(count * 3), a = new Float32Array(count), v = new THREE.Vector3();
    for (let i = 0; i < count; i++) { v.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(); p.set([v.x, v.y, v.z], i * 3); a[i] = r(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(a, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), size * 2.2);
    return g;
  }, [size, count]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 9 }, uR: { value: size }, uGlow: { value: 0 }, uColor: { value: new THREE.Color(color) } },
  }), [size, color]);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock, gl }) => {
    const g = glow();
    mat.uniforms.uTime.value = reduced ? 5 : clock.elapsedTime;
    mat.uniforms.uScale.value = gl.getPixelRatio() * 16;
    mat.uniforms.uGlow.value = Number.isFinite(g) ? Math.min(1, Math.max(0, g)) : 0;
  });
  return count > 0 ? <points geometry={geo} material={mat} /> : null;
}
