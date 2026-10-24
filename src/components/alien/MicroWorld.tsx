"use client";
// Micro-worlds: what a world turns into as you approach it. Far it is only its identity colour (nothing here draws);
// mid, its biggest spires and domes rise along its pattern and an orbital ring appears; close, thousands of structures,
// lit windows on the night side, space-elevator climbers and ships between the surface and the ring.
// Everything is instanced and placed/animated in vertex shaders from static attributes: the CPU only sets a few uniforms
// and draw counts per frame. Placement asks the same famSite() the surface shader uses for its night-side cities, so
// structures stand on band edges, marble veins, crater rims and land. Children of the planet mesh: they turn with it.
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { NOISE } from "./LiquidPlanet";
import { compileAs } from "../WarmCompile";
import { cityDensity, microStage, newStage, rankCount, structureBudget } from "./micro-pure";

type N1 = { value: number };
/** The planet material's uniforms this layer shares (same objects: time, pattern family, seed, chrome, city switch). */
export type MicroShared = { uTime: N1; uFam: N1; uSeed: { value: THREE.Vector3 }; uChrome: N1; uCity: N1; uLens: { value: THREE.Vector3 }; uLensK: N1; uLensR: N1 };

const noRay = () => {}; // never raycast: clicks and hover belong to the planet sphere
const TAU = Math.PI * 2;

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Lit by the CORE (a point light at the world origin), a cold rim, and the shared varyings of every lit micro mesh. */
const LIT = /* glsl */ `
vec3 microLit(vec3 W, vec3 N, vec3 alb, float spec) {
  vec3 L = normalize(-W), V = normalize(cameraPosition - W);
  float d = max(dot(N, L), 0.0);
  float s = pow(max(dot(reflect(-L, N), V), 0.0), 28.0) * spec * d;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  return alb * (0.03 + d * 1.05) + vec3(1.0, 0.96, 0.9) * s + vec3(0.5, 0.6, 0.9) * rim * 0.05;
}`;
const VARY = /* glsl */ `varying vec3 vW; varying vec3 vN; varying vec3 vL; varying float vNight;`;
// night = this point's ground faces away from the CORE (c = planet centre, world)
const NIGHT = /* glsl */ `float nightOf(vec3 w, vec3 c) { return smoothstep(0.12, -0.22, dot(normalize(w - c), normalize(-w))); }`;

/* ---------- surface structures ---------- */
const STRUCT_VS = /* glsl */ `
attribute vec3 aDir; attribute vec4 aS; // aS: width, height (planet radii), rank, yaw
uniform float uR; uniform float uShow; uniform float uPx; uniform float uChrome; uniform float uTime;
uniform vec3 uLens; uniform float uLensK; uniform float uLensR;
${VARY}
${NIGHT}
void main() {
  float grow = smoothstep(aS.z, aS.z + 0.07, uShow);
  float disp = uChrome * 0.018 * (sin(aDir.x * 5.0 + uTime * 0.9) * sin(aDir.y * 4.0 - uTime * 0.7) + sin(aDir.z * 6.0 + uTime * 1.1) * 0.6);
  vec3 base = aDir * uR * (0.997 + disp);
  vec4 bv = modelViewMatrix * vec4(base, 1.0);
  float px = max(aS.x, aS.y) * uR * uPx / max(-bv.z, 1e-3);
  float k = grow * smoothstep(0.7, 2.2, px) * step(0.0, -bv.z); // no sub-pixel slivers: grow in as they resolve
  k *= 1.0 - uLensK * (1.0 - smoothstep(0.75, 1.05, length(aDir - uLens) / max(uLensR, 1e-3))); // the x-ray lens sinks them
  vec3 up = aDir, ax = abs(up.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(ax, up)), b = cross(t, up); // (t, up, b) right-handed: the winding survives
  float c = cos(aS.w), s = sin(aS.w); vec3 T = t * c + b * s, B = b * c - t * s;
  vec3 sc = vec3(aS.x, aS.y, aS.x);
  vec3 lp = position * sc * uR * k, nn = normal / sc;
  vec4 w = modelMatrix * vec4(base + T * lp.x + up * lp.y + B * lp.z, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * (T * nn.x + up * nn.y + B * nn.z));
  vL = vec3(position.y, aS.z, fract(aS.w * 7.31));
  vNight = nightOf(w.xyz, (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const LIT_FS = /* glsl */ `
uniform vec3 uBody; uniform float uTime; uniform float uTip; uniform float uRows; uniform float uFade;
${VARY}
float hh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
${LIT}
void main() {
  vec3 N = normalize(vN);
  float ao = 0.4 + 0.6 * smoothstep(0.0, 0.45, vL.x); // darker at the foot: they stand on the ground, not float over it
  vec3 c = microLit(vW, N, uBody * (0.7 + 0.6 * vL.z) * ao, 0.25) + uBody * vec3(1.0, 0.9, 0.78) * vNight * 0.06 * ao; // night: the city glow from below
  // windows: rows of lit cells on the night side, anti-aliased, gone once a row is under a pixel tall
  float y = vL.x * uRows, fy = fwidth(y), r = fract(y);
  float row = smoothstep(0.3 - fy, 0.3 + fy, r) * (1.0 - smoothstep(0.7 - fy, 0.7 + fy, r)) * (1.0 - smoothstep(0.25, 0.5, fy));
  float lit = step(0.42, hh(vec2(floor(y), vL.z * 91.0 + floor(vL.z * 13.0))));
  c += vec3(1.0, 0.9, 0.76) * row * lit * vNight * 0.4 * step(0.06, vL.x) * (1.0 - step(0.9, vL.x));
  // a beacon on the tip: a slow breath, never a strobe
  float tip = smoothstep(0.93, 1.0, vL.x) * uTip;
  c += vec3(0.62, 0.76, 1.0) * tip * (0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * 1.3 + vL.z * 40.0), 6.0)) * (0.5 + vNight);
  gl_FragColor = vec4(max(c, vec3(0.0)), uFade);
}`;

function kindGeos() {
  const m = (g: THREE.BufferGeometry[]) => { const r = mergeGeometries(g.map((x) => x.toNonIndexed()))!; g.forEach((x) => x.dispose()); return r; };
  return [
    // spire: a plinth and a six-sided needle
    m([new THREE.CylinderGeometry(0.9, 1, 0.06, 6).translate(0, 0.03, 0), new THREE.ConeGeometry(0.5, 0.94, 6).translate(0, 0.53, 0)]),
    // dome: a hemisphere on a ring
    m([new THREE.SphereGeometry(0.5, 10, 4, 0, TAU, 0, Math.PI / 2).scale(1, 2, 1), new THREE.CylinderGeometry(0.55, 0.6, 0.06, 10, 1, true).translate(0, 0.03, 0)]),
    // antenna tower: mast, two crossbars and a bead
    m([new THREE.CylinderGeometry(0.4, 0.5, 1, 4).translate(0, 0.5, 0), new THREE.BoxGeometry(7, 0.025, 0.6).translate(0, 0.62, 0),
      new THREE.BoxGeometry(0.6, 0.025, 5).translate(0, 0.8, 0), new THREE.SphereGeometry(1.4, 6, 4).translate(0, 1, 0)]),
    // arcology: stepped tiers
    m([new THREE.BoxGeometry(1, 0.45, 1).translate(0, 0.225, 0), new THREE.BoxGeometry(0.72, 0.35, 0.72).translate(0, 0.625, 0),
      new THREE.BoxGeometry(0.42, 0.3, 0.42).translate(0, 0.95, 0)]),
  ];
}
// per kind: share of the candidates, window rows, tip beacon
const KINDS = [{ p: 0.22, rows: 18, tip: 1 }, { p: 0.24, rows: 0.01, tip: 0 }, { p: 0.12, rows: 0.01, tip: 1 }, { p: 0.42, rows: 9, tip: 0 }];

type Placed = { d: [number, number, number]; s: [number, number, number, number] }[][];
/** n structures where the cities are, per kind, sorted by rank (big ones rank first: what mid range shows). Resumable:
 *  each call works until `deadline` (performance.now ms) and returns the result once done, so ~10^5 noise samples are
 *  spread over a few frames of the approach instead of one hitch. */
function placer(n: number, seed: number, fam: number, sd: THREE.Vector3) {
  const r = seeded(seed * 7919 + 13), sv: [number, number, number] = [sd.x, sd.y, sd.z];
  const out: Placed = KINDS.map(() => []);
  let i = 0, tries = 0, res: Placed | null = null;
  return (deadline: number) => {
  for (; !res && i < n && tries < n * 25; tries++) {
    if ((tries & 63) === 0 && performance.now() > deadline) return null;
    const z = r() * 2 - 1, a = r() * TAU, q = Math.sqrt(1 - z * z);
    const d: [number, number, number] = [q * Math.cos(a), z, q * Math.sin(a)];
    if (r() > 0.025 + cityDensity(d, fam, sv) * 1.2) continue; // the cities (and a few outposts) decide who lives where
    i++;
    let k = 0; for (let u = r(), acc = KINDS[0].p; u > acc && k < 3; acc += KINDS[++k].p);
    const s = Math.pow(r(), 2.6), j = r(), mega = r() < 0.01 ? 2.2 : 1;
    let w, h;
    if (k === 0) { h = (0.005 + 0.016 * s) * mega; w = h * (0.14 + 0.06 * j); }
    else if (k === 1) { w = 0.006 + 0.022 * s; h = w * (0.22 + 0.16 * j); }
    else if (k === 2) { h = 0.006 + 0.018 * s; w = h * 0.04; }
    else { w = 0.005 + 0.014 * s; h = w * (0.7 + 1.3 * j); }
    const rank = Math.min(0.999, (1 - Math.min(1, s * mega)) * 0.78 + r() * 0.22);
    out[k].push({ d, s: [w, h, rank, r() * TAU] });
  }
  return (res ??= out.map((l) => l.sort((x, y) => x.s[2] - y.s[2])));
  };
}

function litMat(vs: string, u: Record<string, { value: unknown }>, extra: Record<string, { value: unknown }>, transparent = false) {
  return new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: LIT_FS, uniforms: { ...u, ...extra }, transparent });
}

/* ---------- orbital infrastructure: ring, station modules, elevators, climbers, ships ---------- */
const MOD_VS = /* glsl */ `
uniform float uK; ${VARY} ${NIGHT}
float hs(float x) { return fract(sin(x * 91.7) * 43758.5453); }
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position * uK, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vL = vec3(uv.y, 0.5, hs(float(gl_InstanceID)));
  vNight = nightOf(w.xyz, (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const CLIMB_VS = /* glsl */ `
attribute vec2 aC; uniform float uR; uniform float uRr; uniform float uTime; uniform float uK; ${VARY} ${NIGHT}
void main() {
  float ph = 0.5 - 0.5 * cos(uTime * 0.09 + aC.y * 6.2831853); // eases out of the dock, cruises, eases in
  float r = mix(uR * 1.012, uRr * 0.985, ph);
  vec3 d = vec3(cos(aC.x), 0.0, sin(aC.x)), tg = vec3(-d.z, 0.0, d.x), Y = vec3(0.0, 1.0, 0.0);
  vec3 lp = position * vec3(0.007, 0.016, 0.007) * uR * uK;
  vec4 w = modelMatrix * vec4(d * (r + lp.y) + tg * lp.x + Y * lp.z, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * (d * normal.y + tg * normal.x + Y * normal.z));
  vL = vec3(position.y + 0.5, 0.5, fract(aC.y * 7.0));
  vNight = nightOf(w.xyz, (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
// Tethers and ships: camera-facing strips, never thinner than ~1.4 px (they fade by coverage instead). Additive.
const LINE_VS = /* glsl */ `
attribute vec3 aA; attribute vec3 aB; attribute vec4 aP; // aP: kind (0 tether, 1 ship), seed, width (radii), speed
uniform float uR; uniform float uTime; uniform float uPx; uniform float uK; uniform float uShip;
varying float vS; varying float vX; varying float vA; varying float vKind; varying float vSeed;
vec3 ctrl() { return normalize(aA + aB + vec3(0.0, 1e-4, 0.0)) * (length(aA) + length(aB)) * 0.56; }
void main() {
  float s = position.y + 0.5, a = uK;
  vec3 P, D;
  if (aP.x < 0.5) { P = mix(aA, aB, s); D = aB - aA; }
  else {
    float t = fract(uTime * aP.w + aP.y);
    float u = mix(max(t - 0.06, 0.0), t, s);
    vec3 c = ctrl();
    P = mix(mix(aA, c, u), mix(c, aB, u), u); D = (c - aA) * (1.0 - u) + (aB - c) * u;
    a *= uShip * smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.88, 1.0, t));
  }
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  vec3 dv = mat3(modelViewMatrix) * D;
  vec3 side = cross(dv, mv.xyz); float sl = length(side); side = sl > 1e-9 ? side / sl : vec3(1.0, 0.0, 0.0);
  float z = max(-mv.z, 1e-3), wt = aP.z * uR, wm = 1.4 * z / max(uPx, 1.0);
  mv.xyz += side * position.x * max(wt, wm);
  vA = a * min(1.0, wt / wm) * step(0.0, -mv.z);
  vS = s; vX = position.x * 2.0; vKind = aP.x; vSeed = aP.y;
  gl_Position = projectionMatrix * mv;
}`;
const LINE_FS = /* glsl */ `
uniform float uTime; varying float vS; varying float vX; varying float vA; varying float vKind; varying float vSeed;
void main() {
  float across = exp(-vX * vX * 3.5);
  vec3 c;
  if (vKind < 0.5) { float bead = pow(0.5 + 0.5 * sin(vS * 34.0 - uTime * 1.6 + vSeed * 40.0), 14.0); c = vec3(0.66, 0.77, 1.0) * (0.3 + 1.0 * bead); }
  else c = mix(vec3(0.5, 0.62, 1.0), vec3(1.0, 0.98, 0.95), vS * vS) * (0.08 + 1.5 * pow(vS, 4.0));
  gl_FragColor = vec4(max(c * across * vA, vec3(0.0)), 1.0);
}`;
const RING_VS = /* glsl */ `varying vec3 vP; varying vec3 vNl; varying vec3 vW; varying vec3 vN; varying float vNight; ${NIGHT}
void main() { vP = position; vNl = normal; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
  vNight = nightOf(w.xyz, (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz); gl_Position = projectionMatrix * viewMatrix * w; }`;
const RING_FS = /* glsl */ `
uniform float uTime; uniform float uK; uniform float uRr; uniform float uWd; uniform float uHt; uniform vec3 uBody;
varying vec3 vP; varying vec3 vNl; varying vec3 vW; varying vec3 vN; varying float vNight;
float hh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
${LIT}
void main() {
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  float A = atan(vP.z, vP.x) / 6.2831853 * 720.0, A2 = atan(-vP.z, -vP.x) / 6.2831853 * 720.0;
  float fa = min(fwidth(A), fwidth(A2)); // no seam where atan wraps
  float across = abs(vNl.y) > 0.5 ? (length(vP.xz) - uRr) / uWd * 0.5 + 0.5 : vP.y / uHt + 0.5;
  float seam = (1.0 - smoothstep(0.05, 0.05 + fa, abs(fract(A + 0.5) - 0.5))) * (1.0 - smoothstep(0.3, 0.6, fa));
  vec3 c = microLit(vW, N, uBody * (0.62 - 0.25 * seam), 0.3);
  float fx = fwidth(across);
  float win = step(0.5, hh(vec2(floor(A), 3.0))) * smoothstep(0.38 - fx, 0.38 + fx, across) * (1.0 - smoothstep(0.62 - fx, 0.62 + fx, across));
  c += vec3(1.0, 0.9, 0.76) * win * (1.0 - smoothstep(0.2, 0.5, fa)) * vNight * 0.7;
  float run = exp(-pow((fract(A / 45.0 - uTime * 0.015) - 0.5) * 45.0 / max(1.0, fa * 2.0), 2.0)); // lights running round the ring
  c += vec3(0.62, 0.76, 1.0) * run * (1.0 - smoothstep(0.15, 0.85, abs(across - 0.5) * 2.0)) * 0.9;
  gl_FragColor = vec4(max(c, vec3(0.0)), uK);
}`;

const MW_P = new THREE.Vector3(); // scratch: the world's centre
const TETHERS = 6, CLIMB_PER = 3, SHIPS = 44, MODS = 40;
const ORBIT_R = 1.22; // ring radius in planet radii: inside the thought shell and the holo ring

function Orbitals({ size, u, k, ship, px, body }: { size: number; u: MicroShared; k: N1; ship: N1; px: N1; body: THREE.Color }) {
  const Rr = size * ORBIT_R;
  const parts = useMemo(() => {
    const r = seeded(Math.round(size * 1e4));
    const off = r() * TAU;
    const tA = Array.from({ length: TETHERS }, (_, i) => off + (i / TETHERS) * TAU);
    // ring: a flat track and a short wall, so it reads face-on and edge-on
    const wd = size * 0.014, ht = size * 0.008;
    const ring = mergeGeometries([new THREE.RingGeometry(Rr - wd, Rr + wd, 512, 1).rotateX(-Math.PI / 2).toNonIndexed(), new THREE.CylinderGeometry(Rr, Rr, ht, 512, 1, true).toNonIndexed()])!;
    const shared = { uTime: u.uTime, uK: k, uBody: { value: body } };
    const mats = {
      ring: new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, side: THREE.DoubleSide,
        uniforms: { ...shared, uRr: { value: Rr }, uWd: { value: wd }, uHt: { value: ht } } }),
      mod: litMat(MOD_VS, shared, { uTip: { value: 0 }, uRows: { value: 3 }, uFade: k }, true),
      climb: litMat(CLIMB_VS, shared, { uR: { value: size }, uRr: { value: Rr }, uTip: { value: 1 }, uRows: { value: 2 }, uFade: { value: 1 } }),
      line: new THREE.ShaderMaterial({ vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        uniforms: { uTime: u.uTime, uK: k, uShip: ship, uPx: px, uR: { value: size } } }),
    };
    // station modules: hubs at the tether tops, smaller pods strung between
    const mods = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.mod, MODS + TETHERS);
    mods.frustumCulled = false; mods.raycast = noRay;
    const o = new THREE.Object3D();
    for (let i = 0; i < MODS + TETHERS; i++) {
      const hub = i < TETHERS, a = hub ? tA[i] : r() * TAU, s = hub ? 1 : 0.35 + r() * 0.6;
      o.position.set(Math.cos(a) * Rr, 0, Math.sin(a) * Rr);
      o.rotation.set(0, -a, 0);
      o.scale.set(size * 0.02 * s, size * (hub ? 0.03 : 0.012) * s, size * (hub ? 0.03 : 0.045 + r() * 0.04) * s);
      o.updateMatrix(); mods.setMatrixAt(i, o.matrix);
    }
    // climbers: a few per tether, each on its own schedule
    const climb = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1) as unknown as THREE.InstancedBufferGeometry);
    const aC = new Float32Array(TETHERS * CLIMB_PER * 2);
    for (let i = 0; i < TETHERS * CLIMB_PER; i++) { aC[i * 2] = tA[i % TETHERS]; aC[i * 2 + 1] = r(); }
    climb.setAttribute("aC", new THREE.InstancedBufferAttribute(aC, 2));
    climb.instanceCount = TETHERS * CLIMB_PER;
    // tethers + ships as strips
    const n = TETHERS + SHIPS, aA = new Float32Array(n * 3), aB = new Float32Array(n * 3), aP = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      if (i < TETHERS) {
        const a = tA[i];
        aA.set([Math.cos(a) * size, 0, Math.sin(a) * size], i * 3); aB.set([Math.cos(a) * Rr, 0, Math.sin(a) * Rr], i * 3);
        aP.set([0, r(), 0.0011, 0], i * 4);
      } else { // a surface port (low latitudes) to a dock on the ring, or back
        const lon = r() * TAU, lat = (r() - 0.5) * 0.9, ra = lon + (r() - 0.5) * 1.2;
        const S = [Math.cos(lat) * Math.cos(lon) * size * 1.003, Math.sin(lat) * size * 1.003, Math.cos(lat) * Math.sin(lon) * size * 1.003];
        const E = [Math.cos(ra) * Rr, 0, Math.sin(ra) * Rr];
        const up = r() < 0.5;
        aA.set(up ? S : E, i * 3); aB.set(up ? E : S, i * 3);
        aP.set([1, r(), 0.0022, 0.025 + r() * 0.03], i * 4);
      }
    }
    const line = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry);
    line.setAttribute("aA", new THREE.InstancedBufferAttribute(aA, 3));
    line.setAttribute("aB", new THREE.InstancedBufferAttribute(aB, 3));
    line.setAttribute("aP", new THREE.InstancedBufferAttribute(aP, 4));
    line.instanceCount = n;
    return { ring, mods, climb, line, mats };
  }, [size, Rr, u, k, ship, px, body]);
  useEffect(() => () => {
    parts.ring.dispose(); parts.mods.geometry.dispose(); parts.mods.dispose(); parts.climb.dispose(); parts.line.dispose();
    Object.values(parts.mats).forEach((m) => m.dispose());
  }, [parts]);
  return (
    <>
      <mesh geometry={parts.ring} material={parts.mats.ring} raycast={noRay} />
      <primitive object={parts.mods} />
      <mesh geometry={parts.climb} material={parts.mats.climb} raycast={noRay} frustumCulled={false} />
      <mesh geometry={parts.line} material={parts.mats.line} raycast={noRay} frustumCulled={false} renderOrder={2} />
    </>
  );
}

/** A planet's micro-world. Mount as a child of the planet mesh (it turns with the surface). */
export function MicroWorld({ size, u, level, orbital, body, seed }: {
  size: number; u: MicroShared; level: number; orbital: boolean; body: string; seed: number;
}) {
  const budget = structureBudget(level);
  const uni = useMemo(() => ({ show: { value: 0 }, px: { value: 600 }, orbit: { value: 0 }, ship: { value: 0 }, body: new THREE.Color(body).lerp(new THREE.Color("#b9c0cf"), 0.4).multiplyScalar(0.8) }), [body]);
  const job = useMemo(() => (budget > 0 ? placer(budget, seed, u.uFam.value, u.uSeed.value) : null), [budget, seed, u]);
  const [placed, setPlaced] = useState<{ job: unknown; pl: Placed } | null>(null);
  const sent = useRef<unknown>(null);
  const dwell = useRef(0); // seconds the camera has stayed within this world's orbit stage
  const kinds = useMemo(() => {
    if (!job || placed?.job !== job) return null;
    const geos = kindGeos();
    return placed.pl.map((list, i) => {
      const g = new THREE.InstancedBufferGeometry().copy(geos[i] as unknown as THREE.InstancedBufferGeometry);
      geos[i].dispose();
      const dir = new Float32Array(list.length * 3), s = new Float32Array(list.length * 4), ranks = new Float32Array(list.length);
      list.forEach((it, j) => { dir.set(it.d, j * 3); s.set(it.s, j * 4); ranks[j] = it.s[2]; });
      g.setAttribute("aDir", new THREE.InstancedBufferAttribute(dir, 3));
      g.setAttribute("aS", new THREE.InstancedBufferAttribute(s, 4));
      g.instanceCount = 0;
      const mat = litMat(STRUCT_VS, { uTime: u.uTime, uChrome: u.uChrome, uLens: u.uLens, uLensK: u.uLensK, uLensR: u.uLensR },
        { uR: { value: size }, uShow: uni.show, uPx: uni.px, uBody: { value: uni.body }, uTip: { value: KINDS[i].tip }, uRows: { value: KINDS[i].rows }, uFade: { value: 1 } });
      return { g, mat, ranks };
    });
  }, [job, placed, size, u, uni]);
  useEffect(() => () => kinds?.forEach((k) => { k.g.dispose(); k.mat.dispose(); }), [kinds]);
  // New materials would compile synchronously on their first draw (a freeze mid-flight): compile them in parallel first.
  const { gl, camera: cam, get } = useThree();
  const ready = useRef<unknown>(null);
  useEffect(() => {
    if (!kinds || !root.current) return;
    let alive = true;
    const g = root.current, hid: THREE.Object3D[] = [];
    g.traverse((o) => { if (!o.visible) { hid.push(o); o.visible = true; } });
    const counts = kinds.map((k) => k.g.instanceCount);
    kinds.forEach((k) => { k.g.instanceCount = 0; });
    const p = compileAs(gl, g, cam, get().internal.priority > 0); // collected synchronously: restore visibility at once (see WarmCompile)
    hid.forEach((o) => { o.visible = false; });
    p.catch(() => {}).finally(() => { kinds.forEach((k, i) => { k.g.instanceCount = counts[i]; }); if (alive) ready.current = kinds; });
    return () => { alive = false; };
  }, [kinds, gl, cam, get]);
  useEffect(() => () => { u.uCity.value = 0; }, [u]); // unmounted (quality 0): the cities go dark with it
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const [stage] = useState(newStage);
  const root = useRef<THREE.Group>(null);
  const orb = useRef<THREE.Group>(null);

  useFrame(({ camera, size: vp, viewport }, dt) => {
    const g = root.current;
    const st = microStage(g ? size / Math.max(1e-3, camera.position.distanceTo(g.getWorldPosition(MW_P))) : 0, level, stage);
    // Placement only once this world is being approached (its orbit stage begins), never for all 13 at start-up:
    // that cost >= 26 ms a frame for the first seconds on the owner's PC. 2 ms a frame until done.
    // ...and only after the camera has stayed near it ~1 s: hopping planet to planet builds nothing (measured 0.4–1 s stalls).
    dwell.current = st.orbit > 0 ? dwell.current + dt : 0;
    if (job && sent.current !== job && dwell.current > 1) { const pl = job(performance.now() + 2); if (pl) { sent.current = job; setPlaced({ job, pl }); } }
    uni.show.value = st.show;
    uni.px.value = (vp.height * viewport.dpr) / 2 / Math.tan(((camera as THREE.PerspectiveCamera).fov ?? 50) * Math.PI / 360);
    uni.orbit.value = st.orbit;
    uni.ship.value = st.traffic;
    u.uCity.value = st.city;
    if (kinds && ready.current === kinds) for (let i = 0; i < kinds.length; i++) {
      const n = rankCount(kinds[i].ranks, st.show);
      kinds[i].g.instanceCount = n;
      const m = meshes.current[i]; if (m) m.visible = n > 0;
    }
    if (orb.current) orb.current.visible = uni.orbit.value > 0.002;
  });

  return (
    <group ref={root}>
      {kinds?.map((k, i) => <mesh key={i} ref={(m) => { meshes.current[i] = m; }} geometry={k.g} material={k.mat} raycast={noRay} frustumCulled={false} visible={false} />)}
      {orbital && <group ref={orb} visible={false}><Orbitals size={size} u={u} k={uni.orbit} ship={uni.ship} px={uni.px} body={uni.body} /></group>}
    </group>
  );
}

/* ---------- the showpiece: a ringworld band (a Halo) with land, rivers, cloud and air on its inner face ---------- */
const HALO_VS = /* glsl */ `varying vec3 vP; varying vec3 vNl; varying vec3 vW; varying vec3 vN;
void main() { vP = position; vNl = normal; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const HALO_FS = /* glsl */ `
uniform float uTime; uniform float uRw; uniform float uWw; uniform float uDetail;
varying vec3 vP; varying vec3 vNl; varying vec3 vW; varying vec3 vN;
${NOISE}
${LIT}
void main() {
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 V = normalize(cameraPosition - vW), L = normalize(-vW);
  vec3 q = vP / uWw; // the band's own surface coordinates: periodic around the ring, no seam
  float fw = length(fwidth(q));
  float A = atan(vP.z, vP.x) / 6.2831853 * 360.0, A2 = atan(-vP.z, -vP.x) / 6.2831853 * 360.0, fa = min(fwidth(A), fwidth(A2));
  float v = vP.y / uWw + 0.5; // 0..1 across the band
  float dl = max(dot(N, L), 0.0), night = smoothstep(0.05, -0.2, dot(N, L));
  vec3 col;
  if (abs(vNl.y) < 0.5 && !gl_FrontFacing) { // inner face: the land
    float edge = smoothstep(0.0, 0.14, v) * smoothstep(0.0, 0.14, 1.0 - v);
    float hgt = fbm(q * 1.7 + 3.0, fw * 1.7, 2.0 + 4.0 * uDetail) + (1.0 - edge) * 0.55; // mountains rise against the walls
    float coast = smoothstep(0.0, 0.03 + fw * 2.0, hgt);
    vec3 ocean = mix(vec3(0.02, 0.06, 0.13), vec3(0.07, 0.18, 0.27), smoothstep(-0.3, 0.0, hgt));
    vec3 ground = mix(vec3(0.2, 0.26, 0.2), vec3(0.4, 0.39, 0.33), smoothstep(0.05, 0.35, hgt));
    ground = mix(ground, vec3(0.86, 0.88, 0.92), smoothstep(0.45, 0.58, hgt));
    float rv = abs(fbm(q * 3.1 + 9.0, fw * 3.1, 4.0));
    float river = (1.0 - smoothstep(0.012, 0.024 + fw * 2.0, rv)) * coast * (1.0 - smoothstep(0.25, 0.4, hgt)) * (1.0 - smoothstep(0.02, 0.05, fw));
    vec3 alb = mix(mix(ocean, ground, coast), ocean * 1.4, river);
    col = microLit(vW, N, alb, 0.0) + vec3(0.9, 0.95, 1.0) * pow(max(dot(reflect(-L, N), V), 0.0), 40.0) * (1.0 - coast) * dl * 0.5; // sun glint on the seas
    float cl = fbm(q * 2.3 + vec3(uTime * 0.012, 0.0, uTime * 0.008), fw * 2.3, 5.0);
    float cm = smoothstep(0.05, 0.42, cl) * (0.4 + 0.6 * edge);
    col = mix(col, vec3(0.9, 0.92, 0.96) * (0.04 + dl * 1.0), cm * 0.8);
    float cg = step(0.84, h13(floor(q * 70.0))) * coast * (1.0 - cm) * (1.0 - smoothstep(0.25, 0.55, fw * 70.0));
    col += vec3(1.0, 0.9, 0.76) * (cg * 0.7 + coast * (1.0 - cm) * 0.025) * night;
    float graze = pow(1.0 - abs(dot(N, V)), 3.0); // the air: thick at grazing angles and in the valleys against the walls
    col = mix(col, vec3(0.55, 0.7, 1.0) * (0.06 + 0.9 * dl), clamp(graze * 0.65 + (1.0 - edge) * 0.2, 0.0, 0.85));
  } else if (abs(vNl.y) < 0.5) { // outer hull: dark ribbed metal, blue running lights on the edges
    float rib = (1.0 - smoothstep(0.06, 0.06 + fa, abs(fract(A + 0.5) - 0.5))) * (1.0 - smoothstep(0.3, 0.6, fa));
    col = microLit(vW, N, vec3(0.05, 0.055, 0.07) * (1.0 - 0.3 * rib), 0.05);
    float ed = exp(-pow(min(v, 1.0 - v) * 40.0, 2.0)), run = 0.5 + 0.5 * sin(A * 0.5 - uTime * 0.4);
    col += vec3(0.5, 0.65, 1.0) * ed * (0.15 + 0.6 * pow(run, 8.0));
  } else { // the rim walls: pale, banded, their crest catching the light
    float h = (uRw - length(vP.xz)) / max(uWw, 1e-4) * 4.0;
    float band = (1.0 - smoothstep(0.04, 0.04 + fa, abs(fract(A * 0.25 + 0.5) - 0.5)));
    col = microLit(vW, N, vec3(0.5, 0.52, 0.57) * (0.85 - 0.2 * band), 0.1) + vec3(0.75, 0.82, 1.0) * exp(-pow((h - 1.0) * 14.0, 2.0)) * 0.35;
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

const RW_A = new THREE.Vector3(), RW_UP = new THREE.Vector3(0, 1, 0);
export function Ringworld({ size, u, detail, reduced }: { size: number; u: { uTime: N1 }; detail: () => number; reduced: boolean }) {
  const Rw = size * 2.2, Ww = size * 0.4, Wh = size * 0.06;
  const geo = useMemo(() => {
    const wall = (y: number) => new THREE.RingGeometry(Rw - Wh, Rw, 720, 1).rotateX(-Math.PI / 2).translate(0, y, 0).toNonIndexed();
    return mergeGeometries([new THREE.CylinderGeometry(Rw, Rw, Ww, 720, 1, true).toNonIndexed(), wall(Ww / 2), wall(-Ww / 2)])!;
  }, [Rw, Ww, Wh]);
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: HALO_VS, fragmentShader: HALO_FS, side: THREE.DoubleSide,
    uniforms: { uTime: u.uTime, uRw: { value: Rw }, uWw: { value: Ww }, uDetail: { value: 0 } } }), [u, Rw, Ww]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const ref = useRef<THREE.Mesh>(null), tilt = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const d = detail();
    mat.uniforms.uDetail.value = Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0;
    if (ref.current && !reduced) ref.current.rotation.y += Math.min(dt, 0.1) * 0.025; // the band turns: that is its gravity
    const g = tilt.current, par = g?.parent;
    if (g && par) { // the axis leans 20 deg toward the CORE (and the usual view): the far arc rises behind the world, its land facing both
      par.getWorldPosition(RW_A);
      const l = RW_A.lengthSq();
      if (l > 1e-6) { RW_A.multiplyScalar(-1 / Math.sqrt(l)).setY(0).multiplyScalar(0.36).add(RW_UP).normalize(); g.quaternion.setFromUnitVectors(RW_UP, RW_A); }
    }
  });
  return <group ref={tilt}><mesh ref={ref} geometry={geo} material={mat} raycast={noRay} /></group>;
}
