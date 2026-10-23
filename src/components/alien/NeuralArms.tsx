"use client";
// The AI's mind as the galaxy: synapse particles streaming outward along logarithmic spiral arms, with differential
// rotation and random firing. Positions are computed in the vertex shader from per-particle seeds and one time uniform:
// no CPU work per frame. Alpha and colour are clamped finite and >= 0 (bloom NaN rule).
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HOLO } from "./env";

const VS = /* glsl */ `
attribute vec4 aS; uniform float uTime; uniform float uScale; varying vec3 vC; varying float vA;
${HOLO}
float gauss(float a, float b) { return sqrt(-2.0 * log(max(a, 1e-4))) * cos(6.2831853 * b); }
void main() {
  float arms = 3.0, R0 = 3.0, R1 = 64.0;
  float arm = floor(position.x * arms);
  float u = fract(position.y + uTime * 0.0035 * (0.6 + aS.z)); // flowing outward along the arm, forever
  float r = R0 + (R1 - R0) * pow(u, 1.55);
  float disc = step(aS.w, 0.3); // a share of the synapses fill the disc between the arms
  float spread = gauss(position.z, aS.x) * (0.09 + 0.003 * r) * (1.0 - disc) + disc * (aS.x * 6.2831853);
  float th = arm * 6.2831853 / arms + 1.75 * log(r / R0) + spread - uTime * 0.9 / sqrt(r);
  float h = gauss(aS.y, aS.z) * (0.12 + 0.015 * r) * (1.0 + disc);
  vec3 p = vec3(cos(th) * r, h, sin(th) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float z = max(-mv.z, 0.1);
  float fire = pow(max(sin(uTime * (0.6 + aS.x * 1.7) + aS.y * 80.0), 0.0), 24.0);
  float edge = smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.82, 1.0, u));
  // far points are sub-pixel (clamped to 1 px): raise their alpha so the arms still read from the overview
  vA = edge * (0.16 + 0.55 * smoothstep(12.0, 50.0, z) + 1.4 * fire) * (1.0 - disc * 0.55) * smoothstep(3.0, 14.0, z);
  vC = mix(vec3(0.95, 0.97, 1.0), holo(0.5 + r * 0.011 + aS.x * 0.18 + arm * 0.07 + uTime * 0.006), smoothstep(R0, R0 + 9.0, r));
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
    uniforms: { uTime: { value: 0 }, uScale: { value: 30 } },
  }), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock, gl }) => {
    mat.uniforms.uTime.value = reduced ? 40 : clock.elapsedTime;
    mat.uniforms.uScale.value = gl.getPixelRatio() * 30;
  });
  return count > 0 ? <points geometry={geo} material={mat} frustumCulled={false} /> : null;
}
