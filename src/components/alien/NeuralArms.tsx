"use client";
// The AI's mind as the galaxy: synapse particles streaming outward along logarithmic spiral arms, with differential
// rotation and random firing. Positions are computed in the vertex shader from per-particle seeds and one time uniform:
// no CPU work per frame. Alpha and colour are clamped finite and >= 0 (bloom NaN rule).
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HOLO } from "./env";
import { coreCalm } from "@/lib/alien-pure";

const VS = /* glsl */ `
attribute vec4 aS; uniform float uTime; uniform float uScale; uniform float uCalm; varying vec3 vC; varying float vA;
${HOLO}
float gauss(float a, float b) { return sqrt(-2.0 * log(max(a, 1e-4))) * cos(6.2831853 * b); }
void main() {
  float arms = 3.0, R0 = 3.0, R1 = 64.0;
  float arm = floor(position.x * arms);
  float u = fract(position.y + uTime * 0.0035 * (0.6 + aS.z)); // flowing outward along the arm, forever
  float r = R0 + (R1 - R0) * pow(u, 1.55);
  float disc = step(aS.w, 0.3); // a share of the synapses fill the disc between the arms
  float gs = gauss(position.z, aS.x);
  float spread = gs * (0.09 + 0.003 * r) * (1.0 - disc) + disc * (aS.x * 6.2831853);
  float th = arm * 6.2831853 / arms + 1.75 * log(r / R0) + spread - uTime * 0.9 / sqrt(r);
  float h = gauss(aS.y, aS.z) * (0.12 + 0.015 * r) * (1.0 + disc);
  vec3 p = vec3(cos(th) * r, h, sin(th) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float z = max(-mv.z, 0.1);
  float fire = pow(max(sin(uTime * (0.6 + aS.x * 1.7) + aS.y * 80.0), 0.0), 24.0);
  float edge = smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.82, 1.0, u));
  // structure: a dark dust lane hugging each arm's inner edge, gaps cleared by the orbits, bright knots strung along the arm
  float lane = disc > 0.5 ? 1.0 : 0.12 + 0.88 * smoothstep(0.15, 0.7, abs(gs + 0.75));
  float gap = 0.25 + 0.75 * smoothstep(0.05, 0.45, abs(sin(r * 0.62 + 0.4)));
  float knot = pow(max(sin(u * 70.0 + arm * 2.1 + sin(u * 23.0) * 1.5), 0.0), 18.0) * step(abs(gs), 0.8) * (1.0 - disc);
  edge *= lane * gap * (0.25 + 0.75 * smoothstep(R0, R0 + 8.0, r)); // the inner arms thin out: no white disc around the CORE
  edge *= 1.0 - uCalm * 0.85 * (1.0 - smoothstep(R0, R0 + 12.0, r)); // more so at the overview, where the lens gathers them
  // far points are sub-pixel (clamped to 1 px): raise their alpha so the arms still read from the overview
  vA = edge * (0.16 + 0.55 * smoothstep(12.0, 50.0, z) + 1.4 * fire + 1.6 * knot) * (1.0 - disc * 0.7) * smoothstep(3.0, 14.0, z);
  vC = mix(vec3(0.85, 0.9, 1.0), holo(0.5 + r * 0.018 + aS.x * 0.12 + arm * 0.33 + uTime * 0.006), smoothstep(R0, R0 + 3.0, r));
  vC = mix(vC, vec3(0.35, 0.5, 1.0), (1.0 - lane) * 0.6);          // lane edges go cold blue
  vC = mix(vC, vec3(1.0, 0.75, 0.9), knot * 0.7);                  // knots burn pink-white
  vC = mix(vC, vec3(1.0), fire * 0.5);
  gl_PointSize = clamp(uScale * (0.35 + 0.9 * aS.w * aS.w + 1.2 * fire) / z, 1.0, 4.0);
  gl_Position = projectionMatrix * mv;
}`;
const FS = /* glsl */ `
varying vec3 vC; varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = max(1.0 - dot(d, d) * 4.0, 0.0);
  gl_FragColor = vec4(clamp(vC, 0.0, 1.0) * 1.1, clamp(a * a * vA, 0.0, 1.0));
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
    uniforms: { uTime: { value: 0 }, uScale: { value: 30 }, uCalm: { value: 0 } },
  }), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock, gl, camera }) => {
    mat.uniforms.uCalm.value = coreCalm(camera.position.length());
    mat.uniforms.uTime.value = reduced ? 40 : clock.elapsedTime;
    mat.uniforms.uScale.value = gl.getPixelRatio() * 30;
  });
  return count > 0 ? <points geometry={geo} material={mat} frustumCulled={false} /> : null;
}
