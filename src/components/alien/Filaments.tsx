"use client";
// Streams of light between the CORE and the worlds, with data pulses racing along them. Each filament is a Bézier
// arc evaluated in the vertex shader from a uniform table of body positions: per frame the CPU copies 14 vectors,
// never touches a vertex. A real backend event on a world brightens every filament touching it.
import { useEffect, useMemo, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PLANETS } from "@/lib/planets";
import { filamentPairs } from "@/lib/alien-pure";
import { HOLO } from "./env";

const IDS = ["core", ...PLANETS.map((p) => p.id)];
const N = IDS.length, SEG = 96;

const head = /* glsl */ `
uniform vec3 uP[${N}]; uniform float uG[${N}]; uniform float uTime; uniform float uScale;
attribute float aT; attribute vec3 aPair; varying vec3 vC; varying float vA;
${HOLO}
void place(out float pulse, out float glow, out vec4 mv) {
  int ia = int(aPair.x + 0.5), ib = int(aPair.y + 0.5);
  vec3 A = uP[ia], B = uP[ib];
  float L = length(B - A), t = aT;
  vec3 M = (A + B) * 0.5 + vec3(0.0, (0.12 + 0.12 * aPair.z) * L * (aPair.z > 0.5 ? 1.0 : -1.0), 0.0);
  vec3 p = (1.0 - t) * (1.0 - t) * A + 2.0 * (1.0 - t) * t * M + t * t * B;
  glow = clamp(max(uG[ia], uG[ib]), 0.0, 1.0);
  float speed = (0.05 + 0.07 * aPair.z) * (1.0 + 2.0 * glow) * 30.0 / max(L, 3.0);
  float hd = fract(uTime * speed + aPair.z * 17.0);
  if (aPair.z > 0.5) hd = 1.0 - hd; // half the streams flow inward to the CORE
  float d = aPair.z > 0.5 ? t - hd : hd - t; // distance behind the head
  pulse = d >= 0.0 ? exp(-d * 30.0) : exp(-d * d * 9000.0);
  mv = modelViewMatrix * vec4(p, 1.0);
  vC = mix(holo(t * 0.6 + aPair.z + uTime * 0.03), vec3(1.0), pulse * 0.7);
}`;

const LINE_VS = head + /* glsl */ `void main(){ float pulse, glow; vec4 mv; place(pulse, glow, mv);
  vA = 0.05 + 0.12 * glow + pulse * (0.8 + glow); gl_Position = projectionMatrix * mv; }`;
const DOT_VS = head + /* glsl */ `void main(){ float pulse, glow; vec4 mv; place(pulse, glow, mv);
  vA = pulse; gl_PointSize = pulse > 0.05 ? clamp(uScale * pulse / max(-mv.z, 0.1), 0.0, 14.0) : 0.0; gl_Position = projectionMatrix * mv; }`;
const LINE_FS = /* glsl */ `varying vec3 vC; varying float vA; void main(){ gl_FragColor = vec4(clamp(vC, 0.0, 1.0) * 1.3, clamp(vA, 0.0, 1.0)); }`;
const DOT_FS = /* glsl */ `varying vec3 vC; varying float vA;
  void main(){ vec2 d = gl_PointCoord - 0.5; float a = max(1.0 - dot(d, d) * 4.0, 0.0);
    gl_FragColor = vec4(clamp(vC, 0.0, 1.0) * 2.2, clamp(a * a * a * vA, 0.0, 1.0)); }`;

export function Filaments({ positions, pulses, reduced }: { positions: Record<string, THREE.Vector3>; pulses: RefObject<Record<string, number>>; reduced: boolean }) {
  const { line, dots } = useMemo(() => {
    const pairs = filamentPairs(N - 1), V = pairs.length * (SEG + 1);
    const t = new Float32Array(V), pr = new Float32Array(V * 3), index: number[] = [];
    pairs.forEach(([a, b], k) => {
      const z = ((k * 0.618034) % 1); // spreads speeds and directions without randomness
      for (let s = 0; s <= SEG; s++) {
        const i = k * (SEG + 1) + s;
        t[i] = s / SEG; pr.set([a, b, z], i * 3);
        if (s) index.push(i - 1, i);
      }
    });
    const attrs = { position: new THREE.BufferAttribute(new Float32Array(V * 3), 3), aT: new THREE.BufferAttribute(t, 1), aPair: new THREE.BufferAttribute(pr, 3) };
    const line = new THREE.BufferGeometry(), dots = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(attrs)) { line.setAttribute(k, a); dots.setAttribute(k, a); }
    line.setIndex(index); // dots stay unindexed: each vertex drawn once
    return { line, dots };
  }, []);
  const uniforms = useMemo(() => ({
    uP: { value: IDS.map(() => new THREE.Vector3()) }, uG: { value: new Array<number>(N).fill(0) }, uTime: { value: 0 }, uScale: { value: 60 },
  }), []);
  const mats = useMemo(() => {
    const base = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, uniforms };
    return { line: new THREE.ShaderMaterial({ ...base, vertexShader: LINE_VS, fragmentShader: LINE_FS }), dots: new THREE.ShaderMaterial({ ...base, vertexShader: DOT_VS, fragmentShader: DOT_FS }) };
  }, [uniforms]);
  useEffect(() => () => { line.dispose(); dots.dispose(); mats.line.dispose(); mats.dots.dispose(); }, [line, dots, mats]);

  useFrame(({ clock, gl }) => {
    const P = uniforms.uP.value, G = uniforms.uG.value, now = Date.now();
    for (let i = 1; i < N; i++) { // index 0 is the CORE at the origin
      const v = positions[IDS[i]];
      if (v) P[i].copy(v);
      const g = 1 - (now - (pulses.current?.[IDS[i]] ?? 0)) / 3000;
      G[i] = g > 0 && g <= 1 ? g : 0;
    }
    const gc = 1 - (now - (pulses.current?.core ?? 0)) / 3000;
    G[0] = gc > 0 && gc <= 1 ? gc : 0;
    uniforms.uTime.value = reduced ? 0 : clock.elapsedTime;
    uniforms.uScale.value = gl.getPixelRatio() * 60;
  });

  return (
    <>
      <lineSegments geometry={line} material={mats.line} frustumCulled={false} />
      {!reduced && <points geometry={dots} material={mats.dots} frustumCulled={false} />}
    </>
  );
}
