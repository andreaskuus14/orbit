"use client";
// CORE as a living GPGPU swarm: position/velocity ping-pong on the GPU, pulled by curl noise toward one of three
// shapes (idle sphere, voice waveform, busy ring) blended by lib/particle-core-pure. Coloured by speed.
// Every shader output is finite and >= 0: one NaN or negative pixel gets smeared over the whole screen by Bloom.

import { useEffect, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import { newCoreState, stepCore, waveAmp, type CoreInput } from "@/lib/particle-core-pure";

/** Written by NeuralCore every frame: pulse glow, smoothed mic/speak levels, breath (all 0..1). */
export type CoreLive = { g: number; mic: number; spk: number; breath: number };

const SIM_HEAD = /* glsl */ `
uniform float uTime; uniform float uDt;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
bool bad(vec3 v) { return any(isnan(v)) || any(isinf(v)); }
`;

const VEL = SIM_HEAD + /* glsl */ `
uniform vec3 uW; uniform float uR; uniform float uWave; uniform float uFlare;
// Divergence-free: no component depends on its own axis. Two octaves of cos are far cheaper than simplex curl.
vec3 curl(vec3 p) {
  float t = uTime * 0.35;
  return vec3(cos(p.y * 1.3 + t), cos(p.z * 1.2 - t), cos(p.x * 1.1 + t * 0.7))
       + 0.5 * vec3(sin(p.z * 2.7 - t), sin(p.x * 2.3 + t), sin(p.y * 2.9 - t * 1.3));
}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 p = texture2D(texturePosition, uv).xyz;
  vec3 v = texture2D(textureVelocity, uv).xyz;
  float h1 = hash(uv), h2 = hash(uv + 0.37), h3 = hash(uv + 1.71);
  // idle: loose shell
  float z = h1 * 2.0 - 1.0, ph = h2 * 6.2831853, rr = sqrt(max(1.0 - z * z, 0.0));
  vec3 sphere = vec3(rr * cos(ph), z, rr * sin(ph)) * uR * (0.82 + 0.3 * h3);
  // voice: horizontal waveform, tapered at the ends
  float x = (h1 * 2.0 - 1.0) * 3.0, env = max(1.0 - (x * x) / 9.0, 0.0);
  float y = sin(x * 2.2 - uTime * 4.0) * (0.65 + 0.35 * sin(x * 5.1 + uTime * 2.7)) * uWave * env;
  vec3 wave = vec3(x, y + (h3 - 0.5) * 0.12, (h2 - 0.5) * 0.5 * env);
  // busy: spinning torus
  float th = h1 * 6.2831853 + uTime * 1.6, ring = 2.1 + 0.3 * (0.4 + h3) * cos(ph);
  vec3 torus = vec3(ring * cos(th), 0.3 * (0.4 + h3) * sin(ph), ring * sin(th));
  vec3 target = uW.x * sphere + uW.y * wave + uW.z * torus;
  float l = length(p);
  vec3 outward = l > 1e-4 ? p / l : vec3(0.0, 1.0, 0.0); // normalize(0) is NaN
  vec3 acc = (target - p) * 6.0 - v * 2.5 + curl(p * 0.9) * (0.6 + 0.6 * uW.x) + outward * uFlare * uFlare * 8.0;
  v += acc * uDt;
  float s = length(v);
  if (s > 8.0) v *= 8.0 / s;
  if (bad(v)) v = vec3(0.0);
  gl_FragColor = vec4(v, 1.0);
}`;

const POS = SIM_HEAD + /* glsl */ `
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 p = texture2D(texturePosition, uv).xyz + texture2D(textureVelocity, uv).xyz * uDt;
  if (bad(p) || dot(p, p) > 400.0) p = vec3(0.0);
  gl_FragColor = vec4(p, 1.0);
}`;

const RENDER_VS = /* glsl */ `
uniform sampler2D uPos; uniform sampler2D uVel; uniform float uScale; uniform float uRed; uniform float uFlare;
attribute vec2 aRef; varying vec3 vCol;
void main() {
  vec3 p = texture2D(uPos, aRef).xyz;
  if (any(isnan(p)) || any(isinf(p))) p = vec3(0.0);
  float s = length(texture2D(uVel, aRef).xyz);
  float k = s < 1e9 ? clamp(s / 4.0, 0.0, 1.0) : 0.0; // NaN fails the compare
  // igloo-style speed ramp: deep blue at rest, cyan-white cruising, warm gold when fast
  vec3 c = k < 0.5 ? mix(vec3(0.12, 0.28, 1.0), vec3(0.45, 0.85, 1.0), k * 2.0) : mix(vec3(0.45, 0.85, 1.0), vec3(1.0, 0.85, 0.5), k * 2.0 - 1.0);
  c = mix(c, vec3(1.0, 0.2, 0.24) * (0.6 + k), clamp(uRed, 0.0, 1.0) * 0.75);
  vCol = clamp(c * (0.5 + 0.6 * k + clamp(uFlare, 0.0, 1.0) * 1.2), 0.0, 4.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(uScale * (0.8 + 0.6 * k) / max(-mv.z, 0.1), 1.0, 6.0);
  gl_Position = projectionMatrix * mv;
}`;

const RENDER_FS = /* glsl */ `
uniform float uGain; varying vec3 vCol;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = max(1.0 - dot(d, d) * 4.0, 0.0);
  a *= a;
  gl_FragColor = vec4(clamp(vCol, 0.0, 4.0) * uGain, a);
}`;

type Sim = { gpu: GPUComputationRenderer; pos: ReturnType<GPUComputationRenderer["addVariable"]>; vel: ReturnType<GPUComputationRenderer["addVariable"]>; geo: THREE.BufferGeometry; mat: THREE.ShaderMaterial };

function build(gl: THREE.WebGLRenderer, side: number): Sim | null {
  if (!gl.extensions.has("EXT_color_buffer_float")) return null; // float render targets: without them the sim reads zeros
  const gpu = new GPUComputationRenderer(side, side, gl);
  const p0 = gpu.createTexture(), v0 = gpu.createTexture();
  const a = p0.image.data as Float32Array;
  for (let i = 0; i < a.length; i += 4) {
    const z = Math.random() * 2 - 1, ph = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z) * 1.6;
    a[i] = r * Math.cos(ph); a[i + 1] = z * 1.6; a[i + 2] = r * Math.sin(ph); a[i + 3] = 1;
  }
  const pos = gpu.addVariable("texturePosition", POS, p0);
  const vel = gpu.addVariable("textureVelocity", VEL, v0);
  gpu.setVariableDependencies(pos, [pos, vel]);
  gpu.setVariableDependencies(vel, [pos, vel]);
  Object.assign(pos.material.uniforms, { uTime: { value: 0 }, uDt: { value: 0 } });
  Object.assign(vel.material.uniforms, { uTime: { value: 0 }, uDt: { value: 0 }, uW: { value: new THREE.Vector3(1, 0, 0) }, uR: { value: 1.6 }, uWave: { value: 0 }, uFlare: { value: 0 } });
  if (gpu.init()) { gpu.dispose(); return null; }
  const n = side * side, ref = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { ref[i * 2] = ((i % side) + 0.5) / side; ref[i * 2 + 1] = (Math.floor(i / side) + 0.5) / side; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); // only sets the draw count
  geo.setAttribute("aRef", new THREE.BufferAttribute(ref, 2));
  const mat = new THREE.ShaderMaterial({
    vertexShader: RENDER_VS, fragmentShader: RENDER_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uPos: { value: null }, uVel: { value: null }, uScale: { value: 50 }, uRed: { value: 0 }, uFlare: { value: 0 }, uGain: { value: 0.12 * Math.min(1, 16384 / n) } }, // more particles, dimmer each: same total light
  });
  return { gpu, pos, vel, geo, mat };
}

export function ParticleCore({ side, busy, warning, live, onFail }: {
  side: number; busy: boolean; warning: boolean; live: RefObject<CoreLive>; onFail: () => void;
}) {
  const gl = useThree((s) => s.gl);
  const [sim, setSim] = useState<Sim | null>(null);
  const pts = useRef<THREE.Points>(null);
  const st = useRef(newCoreState());
  const inp = useRef<CoreInput>({ busy: false, mic: 0, speak: 0, warning: false });
  // Built in an effect (not useMemo) so StrictMode's double mount and the GL-recovery remount both dispose cleanly.
  useEffect(() => {
    const s = build(gl, side);
    if (!s) { onFail(); return; }
    setSim(s);
    return () => { s.gpu.dispose(); s.geo.dispose(); s.mat.dispose(); setSim(null); };
  }, [gl, side, onFail]);

  useFrame(({ clock, camera }, dt) => {
    if (!sim) return;
    const L = live.current, i = inp.current;
    i.busy = busy; i.mic = L.mic; i.speak = L.spk; i.warning = warning;
    const s = stepCore(st.current, i, dt, st.current);
    const step = Number.isFinite(dt) ? Math.min(1 / 30, Math.max(0, dt)) : 0; // big hitches would make the springs explode
    const t = clock.elapsedTime, g = Number.isFinite(L.g) ? Math.min(1, Math.max(0, L.g)) : 0;
    const pu = sim.pos.material.uniforms, vu = sim.vel.material.uniforms;
    pu.uDt.value = step; pu.uTime.value = t;
    vu.uDt.value = step; vu.uTime.value = t;
    (vu.uW.value as THREE.Vector3).set(s.w[0], s.w[1], s.w[2]);
    vu.uR.value = 1.6 * (1 + 0.06 * (Number.isFinite(L.breath) ? L.breath : 0) + 0.1 * g);
    vu.uWave.value = waveAmp(L.mic, L.spk);
    vu.uFlare.value = g;
    sim.gpu.compute();
    const mu = sim.mat.uniforms;
    mu.uPos.value = sim.gpu.getCurrentRenderTarget(sim.pos).texture;
    mu.uVel.value = sim.gpu.getCurrentRenderTarget(sim.vel).texture;
    mu.uScale.value = gl.getPixelRatio() * 50;
    mu.uRed.value = s.red; mu.uFlare.value = g;
    // The waveform faces the camera; sphere and ring are round about y, so turning the whole swarm costs nothing visible.
    if (pts.current) pts.current.rotation.y = Math.atan2(camera.position.x, camera.position.z);
  });

  return sim ? <points ref={pts} geometry={sim.geo} material={sim.mat} frustumCulled={false} /> : null;
}
