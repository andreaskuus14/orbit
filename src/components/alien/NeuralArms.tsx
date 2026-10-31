"use client";
// The AI's mind as the galaxy: synapse particles streaming outward along logarithmic spiral arms, with differential
// rotation and a slow drift (pearl / blue-white / indigo, density on the arms, few bright points). Positions are computed in the vertex shader from per-particle seeds and one time uniform:
// no CPU work per frame. Alpha and colour are clamped finite and >= 0 (bloom NaN rule).
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { coreCalm } from "@/lib/alien-pure";

// Palette: pearl / blue-white with an indigo cast (c8). No rainbow: colour comes from density, lanes and depth.
const VS = /* glsl */ `
attribute vec4 aS; uniform float uTime; uniform float uScale; uniform float uCalm; uniform float uNorm; uniform float uFar; varying vec3 vC; varying float vA;
float gauss(float a, float b) { return sqrt(-2.0 * log(max(a, 1e-4))) * cos(6.2831853 * b); }
void main() {
  float arms = 3.0, R0 = 3.0, R1 = 64.0;
  float arm = floor(position.x * arms);
  float u = fract(position.y + uTime * 0.0018 * (0.6 + aS.z)); // a slow outward drift along the arm
  float r = R0 + (R1 - R0) * pow(u, 1.55);
  float disc = step(aS.w, 0.14); // a small share fills the disc between the arms: structure, not confetti
  float gs = gauss(position.z, aS.x);
  float spread = gs * (0.08 + 0.0028 * r) * (1.0 - disc) + disc * (aS.x * 6.2831853);
  float th = arm * 6.2831853 / arms + 1.75 * log(r / R0) + spread - uTime * 0.45 / sqrt(r);
  float h = gauss(aS.y, aS.z) * (0.1 + 0.012 * r) * (1.0 + disc);
  vec3 p = vec3(cos(th) * r, h, sin(th) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float z = max(-mv.z, 0.1);
  float edge = smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.82, 1.0, u));
  // a dark dust lane hugging each arm's inner edge; gaps cleared by the orbits; density peaks on the arm's spine
  float lane = disc > 0.5 ? 1.0 : 0.05 + 0.95 * smoothstep(0.2, 0.8, abs(gs + 0.75));
  float gap = 0.65 + 0.35 * smoothstep(0.05, 0.45, abs(sin(r * 0.62 + 0.4))); // orbits clear the dust a little (no concentric rings)
  float spine = exp(-gs * gs * 0.9);
  edge *= lane * gap * (0.2 + 0.8 * smoothstep(R0, R0 + 8.0, r));
  edge *= 1.0 - uCalm * 0.9 * (1.0 - smoothstep(R0, R0 + 12.0, r)); // the overview keeps the CORE's surroundings dark
  float rare = step(0.985, fract(aS.x * 91.7 + aS.y * 13.1)); // ~1.5 %: a few brighter stars in the arms
  vA = edge * (0.22 + 0.5 * spine + 1.2 * rare) * (1.0 - disc * 0.75) * smoothstep(3.0, 14.0, z) * uNorm;
  // pearl at the spine -> cold blue-white -> indigo in the lanes and the outer disc
  float k = clamp(spine * 0.7 + 0.3 * (1.0 - smoothstep(10.0, 50.0, r)), 0.0, 1.0);
  vC = mix(vec3(0.36, 0.42, 0.85), vec3(0.72, 0.8, 1.0), k);
  vC = mix(vC, vec3(0.95, 0.94, 0.92), spine * spine * 0.6 + rare * 0.5);
  vC = mix(vC, vec3(0.3, 0.32, 0.78), (1.0 - lane) * 0.7);
  // never sub-pixel: below 1.5 px draw at 1.5 px and fade by coverage (no twinkle as points cross pixel centres)
  float px = uScale * (0.3 + 0.55 * aS.w * aS.w + 0.5 * rare) / z;
  vA *= px < 1.5 ? (px / 1.5) * (px / 1.5) : 1.0;
  vA *= uFar;
  gl_PointSize = clamp(px, 1.5, 3.0);
  gl_Position = projectionMatrix * mv;
}`;
const FS = /* glsl */ `
varying vec3 vC; varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = max(1.0 - dot(d, d) * 4.0, 0.0);
  gl_FragColor = vec4(clamp(vC, 0.0, 1.0), clamp(a * vA, 0.0, 0.6));
}`;

export function NeuralArms({ count, reduced }: { count: number; reduced: boolean }) {
  const geo = useMemo(() => {
    const r = Math.random; // seeded LCGs correlate consecutive draws: the arms showed lattice stripes
    const p = new Float32Array(count * 3), s = new Float32Array(count * 4);
    for (let i = 0; i < p.length; i++) p[i] = r();
    for (let i = 0; i < s.length; i++) s[i] = r();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3)); // seeds, not positions: the shader places every point
    g.setAttribute("aS", new THREE.BufferAttribute(s, 4));
    return g;
  }, [count]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 30 }, uCalm: { value: 0 }, uNorm: { value: 1 }, uFar: { value: 1 } },
  }), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock, gl, camera }) => {
    mat.uniforms.uCalm.value = coreCalm(camera.position.length());
    mat.uniforms.uTime.value = reduced ? 40 : clock.elapsedTime;
    mat.uniforms.uScale.value = gl.getPixelRatio() * 30;
    mat.uniforms.uNorm.value = Math.min(2.5, 120_000 / Math.max(1, count)); // same brightness at every quality level: no pop on a switch
    mat.uniforms.uFar.value = 0.75 + 0.25 * Math.min(1, camera.position.length() / 40); // close in, the arms surround the camera: thinner
  });
  return count > 0 ? <points geometry={geo} material={mat} frustumCulled={false} /> : null;
}

/* ---------- the veil: the soft volumetric swirl under the synapses (c8) ----------
   One flat disc in the galaxy plane, shaded with 3D gradient noise in log-spiral coordinates: dust streams along the
   three arms (same spiral, same differential rotation as the points), dark lanes on their inner edges, pearl at the
   spines, blue then indigo outward. Drawn first in the opaque queue with additive blending and no depth: it is the
   backdrop the worlds are painted over, so it can never cut a world in half where the plane crosses it. */
const VEIL_VS = /* glsl */ `varying vec2 vP; varying vec3 vW; void main(){ vP = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const VEIL_FS = /* glsl */ `
uniform float uTime; uniform float uCalm; uniform float uGain; varying vec2 vP; varying vec3 vW;
vec3 h33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float gn(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  #define G(o) dot(h33(i + o) * 2.0 - 1.0, f - o)
  return mix(mix(mix(G(vec3(0,0,0)), G(vec3(1,0,0)), u.x), mix(G(vec3(0,1,0)), G(vec3(1,1,0)), u.x), u.y),
             mix(mix(G(vec3(0,0,1)), G(vec3(1,0,1)), u.x), mix(G(vec3(0,1,1)), G(vec3(1,1,1)), u.x), u.y), u.z);
  #undef G
}
void main() {
  float r = max(length(vP), 0.5), lr = log(r / 3.0);
  float ph = atan(vP.y, vP.x) - 1.75 * lr + uTime * 0.45 / sqrt(r); // 0 on an arm's spine (mod 2pi/3)
  float c3 = cos(3.0 * ph), s3 = sin(3.0 * ph);
  float arm = pow(0.5 + 0.5 * c3, 1.8);
  // streaks along the spiral: noise in a periodic (cos, sin, log r) space, octaves fading by their pixel footprint
  vec3 q = vec3(c3 * 2.2, s3 * 2.2, lr * 9.0);
  float fw = length(fwidth(q)), n = 0.0, a = 0.6, f = 1.0;
  for (int i = 0; i < 5; i++) {
    n += a * gn(q * f + float(i) * 3.7) * (1.0 - smoothstep(0.3, 0.6, f * fw));
    f *= 2.1; a *= 0.5;
  }
  vec3 wq = vec3(vP * 0.11, 1.3);
  float cloud = gn(wq) + 0.5 * gn(wq * 2.3 + 4.1) * (1.0 - smoothstep(0.3, 0.6, length(fwidth(wq)) * 2.3)); // volume: blotches across the arms
  float lane = 1.0 - 0.85 * exp(-pow((ph - floor(ph / 2.0943951 + 0.5) * 2.0943951 + 0.32) * 7.0, 2.0)); // inner-edge dust lane
  float env = smoothstep(3.0, 7.0, r) * (1.0 - smoothstep(30.0, 62.0, r)) * (1.0 - uCalm * 0.7 * (1.0 - smoothstep(3.5, 8.0, r)));
  float d = clamp((0.1 + 0.9 * arm) * pow(clamp(0.5 + 1.1 * n, 0.0, 1.6), 1.5) * (0.6 + 0.8 * cloud) * lane + 0.1 * (1.0 - smoothstep(5.0, 40.0, r)), 0.0, 1.6) * env;
  float graze = smoothstep(0.05, 0.3, abs(normalize(vW - cameraPosition).y)); // edge-on, a flat sheet would read as a wall
  vec3 col = mix(vec3(0.16, 0.17, 0.48), vec3(0.32, 0.45, 0.92), smoothstep(0.15, 0.6, d));
  col = mix(col, vec3(0.86, 0.85, 0.9), smoothstep(0.45, 1.0, d) * (1.0 - smoothstep(12.0, 42.0, r)));
  gl_FragColor = vec4(clamp(col * d * uGain * graze, 0.0, 0.8), 1.0);
}`;

export function GalaxyVeil({ reduced }: { reduced: boolean }) {
  const geo = useMemo(() => new THREE.CircleGeometry(64, 128), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VEIL_VS, fragmentShader: VEIL_FS, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false,
    transparent: false, side: THREE.DoubleSide, // opaque queue + renderOrder -10: drawn before every world (see above)
    uniforms: { uTime: { value: 0 }, uCalm: { value: 0 }, uGain: { value: 0.45 } },
  }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(({ clock, camera }) => {
    const d = camera.position.length();
    mat.uniforms.uTime.value = reduced ? 40 : clock.elapsedTime;
    mat.uniforms.uCalm.value = coreCalm(d);
    // inside the disc (close-ups) the veil would fog the whole view: it belongs to the overview
    mat.uniforms.uGain.value = 0.3 * Math.min(1, Math.max(0.25, (d - 8) / 26)); // living galaxy: a calmer backdrop, the data is the hero
  });
  return <mesh geometry={geo} material={mat} rotation-x={-Math.PI / 2} renderOrder={-10} frustumCulled={false} />;
}
