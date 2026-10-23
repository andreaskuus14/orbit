"use client";
// The CORE's Matrioshka brain: four nested Dyson-swarm shells of mirror panels around the singularity. Outer shells are
// obsidian mirrors with chrome bevels and serial glyphs; each panel's star-facing collector face is gold, and inner
// shells run hotter (waste heat, glowing seams), so gaps in the outer shells show warmer layers and the white heart.
// Layout: every shell is a stack of latitude lanes; a lane is a ring of panels that orbits at its own speed on a slowly
// precessing, inclined plane, while the whole shell turns on its own axis. All motion runs in the vertex shader from
// per-instance constants plus a handful of uniforms: no per-panel CPU work, no per-frame allocation.
// - louvers: panels turn edge-on where a drifting interference field peaks, so gaps open and close in waves
// - apertures: a fixed hole per planet where its light filament leaves the swarm (directions follow Filaments' arcs)
// - data waves: thinking / backend events flip panels in a wavefront across the shells, showing the gold, glowing
// Far away a coarser layout with larger panels takes over (a crisp sphere, not sub-pixel noise).
// Every shader output is clamped finite and >= 0 (bloom NaN rule).
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PLANETS } from "@/lib/planets";
import { coreScale } from "@/lib/alien-pure";
import type { CoreLive } from "../ParticleCore";

const SHELLS = [ // outer first: drawn first, so the inner shells are mostly rejected by the depth test
  { r: 3.1, w: 0.045, ax: [0.18, 1, 0.08], lane: 0.05 },
  { r: 2.55, w: -0.07, ax: [-0.5, 0.8, 0.35], lane: -0.08 },
  { r: 2.0, w: 0.1, ax: [0.6, 0.55, -0.6], lane: 0.12 },
  { r: 1.45, w: -0.15, ax: [-0.2, 0.4, 0.9], lane: -0.18 },
] as const;
const NS = SHELLS.length, NH = PLANETS.length;
const NEAR = [8_000, 14_000, 22_000, 30_000]; // panels per quality level, close up
const FAR = [1_400, 1_800, 2_200, 2_600];      // overview: fewer, larger panels

/** Lane layout for `total` panels: per instance aLane = (latitude, start angle, shell, lane speed),
 *  aRnd = (seed, lane seed, circumradius, angle to the lane neighbour). Panel size is the same on every shell. */
function layout(total: number) {
  const sum = SHELLS.reduce((a, s) => a + s.r * s.r, 0);
  const lane: number[] = [], rnd: number[] = [];
  SHELLS.forEach((sh, si) => {
    const R = sh.r, sp = Math.sqrt((4 * Math.PI * R * R) / ((total * R * R) / sum)); // spacing: one panel per sp^2
    const rows = Math.max(3, Math.round((Math.PI * R) / sp)), dl = Math.PI / rows;
    for (let j = 0; j < rows; j++) {
      const lat = -Math.PI / 2 + (j + 0.5) * dl, circ = 2 * Math.PI * R * Math.cos(lat);
      const n = Math.max(3, Math.round(circ / sp)), dth = (2 * Math.PI) / n;
      const size = 0.6 * Math.min(R * dl, circ / n); // flat-top: rows touch; corners overlap neighbours that sit at other heights: a closed skin
      const ls = ((j * 0.618034 + si * 0.37) % 1);
      const w = sh.lane * (0.55 + 0.45 * Math.cos(2 * lat)) * (1 + 0.25 * Math.sin(j * 1.7)); // differential: lanes shear past each other
      for (let k = 0; k < n; k++) {
        lane.push(lat, (k + ls) * dth, si, w);
        rnd.push(((k * 0.7548777 + j * 0.5698403 + si * 0.31) % 1), ls, size, dth);
      }
    }
  });
  return { lane: new Float32Array(lane), rnd: new Float32Array(rnd), n: lane.length / 4 };
}

const COMMON = /* glsl */ `
attribute vec4 aLane; attribute vec4 aRnd;
uniform float uTime; uniform float uPhase; uniform float uGap;
uniform float uR[${NS}]; uniform vec3 uAx[${NS}]; uniform float uW[${NS}];
vec3 rotA(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
// a panel's direction from the star and its direction of travel, dth further along its lane
void lane(float dth, out vec3 d, out vec3 T) {
  int si = int(aLane.z + 0.5);
  float th = aLane.y + dth + aLane.w * uPhase, la = aLane.x;
  d = vec3(cos(la) * cos(th), sin(la), cos(la) * sin(th));
  T = vec3(-sin(th), 0.0, cos(th));
  float ip = aRnd.y * 6.2831853; vec3 ia = vec3(cos(ip), 0.0, sin(ip));
  float inc = 0.003 * sin(uTime * 0.05 + ip); // inclined lanes, slowly precessing (well under a lane's width: the skin stays closed)
  d = rotA(d, ia, inc); T = rotA(T, ia, inc);
  float an = uPhase * uW[si];
  d = rotA(d, uAx[si], an); T = rotA(T, uAx[si], an);
}`;

const PANEL_VS = /* glsl */ `
attribute float aK; // -1: the panel centre, 0..5: rim corners
uniform vec4 uWaveA; uniform vec4 uWaveB; uniform vec3 uHole[${NS * NH}]; uniform float uHoleG[${NH}];
varying vec3 vN; varying vec3 vT; varying vec3 vB; varying vec3 vW; varying vec2 vL; varying float vS; varying float vGlow; varying float vSides; varying float vId; varying float vOpen;
${COMMON}
// a wavefront spreading over the sphere from w.xyz; w.w is its age (s). Returns the flip progress 0..1, adds the front's glow.
float wave(vec4 w, vec3 d, float delay, inout float glow) {
  float age = w.w - delay;
  float x = (age * 1.1 - acos(clamp(dot(d, w.xyz), -1.0, 1.0))) / 0.22;
  glow += exp(-x * x) * step(0.0, age) * (1.0 - smoothstep(2.2, 3.2, age));
  return smoothstep(-1.5, 1.5, x);
}
void main() {
  vec3 d, T; lane(0.0, d, T);
  int si = int(aLane.z + 0.5);
  float R = uR[si] * (1.0 + (fract(aRnd.y * 7.0) - 0.5) * 0.002 + fract(aRnd.x * 31.0) * 0.0015); // overlapping neighbours sit at slightly different heights: no z-fight
  vec3 B = cross(d, T);
  // louver gaps: crests of a travelling wave train, cut into segments by a slower cross wave
  float w1 = sin(dot(d, vec3(0.8, 0.3, -0.52)) * 7.0 - uTime * 0.35 + aLane.z * 1.7);
  float w2 = sin(dot(d, vec3(-0.25, 0.9, 0.36)) * 2.5 + uTime * 0.11 + aLane.z * 2.9);
  float open = smoothstep(0.55, 0.9, w1) * smoothstep(0.0, 0.5, w2) * uGap, rim = 0.0;
  float c0 = cos(0.15 / R), c1 = cos(0.3 / R);
  for (int i = 0; i < ${NH}; i++) { // apertures: zero direction = no hole
    float h = smoothstep(c1, c0, dot(d, uHole[si * ${NH} + i]));
    open = max(open, h); rim += h * (1.0 - h) * 4.0 * uHoleG[i];
  }
  float glow = 0.0, delay = aLane.z * 0.16; // the wave dives inward, shell by shell
  float f = wave(uWaveA, d, delay, glow) + wave(uWaveB, d, delay, glow);
  float th = aLane.y + aLane.w * uPhase;
  float roll = 0.045 * sin(uTime * 0.6 + aRnd.x * 40.0) + open * 1.4 + f * 6.2831853; // glitter jitter, louver, flip
  float pitch = 0.08 * sin(th * 2.0 + aRnd.x * 6.2831853); // tilts as it travels its lane (heliostat)
  vec3 N = rotA(d, T, roll), Bp = rotA(B, T, roll);
  N = rotA(N, Bp, pitch); vec3 Tp = rotA(T, Bp, pitch);
  float sides = (si == 1 || si == 3) ? 5.0 : 6.0;
  vec2 L = vec2(0.0);
  if (aK >= 0.0) { float a = (aK >= sides ? 0.0 : aK) * 6.2831853 / sides; L = vec2(cos(a), sin(a)); }
  vec3 p = d * R + (Tp * L.x + Bp * L.y) * aRnd.z * (1.0 - 0.3 * open);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * N); vT = Tp; vB = Bp; vW = wp.xyz; vL = L;
  vS = aLane.z; vGlow = glow + rim; vSides = sides; vId = aRnd.x; vOpen = open;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const PANEL_FS = /* glsl */ `
uniform float uGlyph;
varying vec3 vN; varying vec3 vT; varying vec3 vB; varying vec3 vW; varying vec2 vL; varying float vS; varying float vGlow; varying float vSides; varying float vId; varying float vOpen;
float hsh(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 43758.5453); }
const vec3 KEY = vec3(-0.37, 0.79, 0.49);
// what an obsidian mirror out here reflects: near-black space, the pearl band of the galaxy plane, one long softbox
vec3 env(vec3 r) {
  vec3 c = vec3(0.006, 0.007, 0.01) + vec3(0.05, 0.055, 0.07) * pow(max(r.y, 0.0), 1.5);
  c += vec3(0.55, 0.57, 0.62) * exp(-pow(r.y * 7.0, 2.0)) * 0.12;
  c += vec3(0.5) * exp(-pow((r.y - 0.55) * 18.0, 2.0)) * smoothstep(0.3, 0.95, cos(atan(r.z, r.x) - 0.6));
  return c;
}
void main() {
  vec3 V = normalize(cameraPosition - vW), N0 = normalize(vN);
  float side = dot(N0, V) >= 0.0 ? 1.0 : -1.0; // +1: the outer obsidian face, -1: the gold collector face (toward the star)
  vec3 N = N0 * side;
  float sec = 6.2831853 / vSides, a = atan(vL.y, vL.x);
  float ea = (floor(a / sec) + 0.5) * sec;
  vec2 en = vec2(cos(ea), sin(ea));
  float de = max(cos(sec * 0.5) - dot(vL, en), 0.0); // distance to the nearest edge, panel units
  float px = max(fwidth(de), 1e-4), bw = 0.13;
  float fine = 1.0 - smoothstep(0.2, 0.55, px / bw); // bevel band under ~3 px: fade to its average, never shimmer
  float bev = (1.0 - smoothstep(0.0, bw, de)) * fine;
  vec3 Nb = normalize(N + normalize(vT * en.x + vB * en.y) * bev * 1.1);
  vec3 R = reflect(-V, Nb);
  float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(Nb, V), 0.0, 1.0), 5.0);
  float heat = pow(vS / 3.0, 1.5); // 0 outer .. 1 inner
  float seam = (1.0 - smoothstep(0.0, max(0.035, px * 1.5), de)) * fine + 0.07 * (1.0 - fine);
  vec3 warm = vec3(1.0, 0.58, 0.24), col;
  if (side > 0.0) {
    col = vec3(0.008, 0.009, 0.012) + env(R) * (0.05 + 0.95 * fr) * (1.0 - 0.8 * vOpen); // louvers turned edge-on: no grazing smear
    col += vec3(1.0, 0.97, 0.92) * (pow(max(dot(R, KEY), 0.0), 320.0) * 2.0 + pow(max(dot(R, KEY), 0.0), 24.0) * 0.03); // glints: the glitter
    col += warm * (heat * 0.3 + seam * heat * 1.3) + vec3(0.62, 0.66, 0.72) * seam * 0.3 * (1.0 - heat);
    vec2 g = (vL - vec2(-0.45, -0.42)) / 0.06; // serial: four 3x5-dot glyphs
    vec2 cell = floor(g); float cx = mod(cell.x, 4.0);
    float lit = step(0.0, cell.x) * step(cell.x, 14.5) * step(0.0, cell.y) * step(cell.y, 4.5) * step(cx, 2.5);
    lit *= step(0.45, hsh(vec2(floor(vId * 4096.0) + floor(cell.x / 4.0) * 7.0, cx * 5.0 + cell.y)));
    vec2 fd = abs(fract(g) - 0.5);
    lit *= (1.0 - smoothstep(0.28, 0.4, max(fd.x, fd.y))) * (1.0 - smoothstep(0.3, 0.6, fwidth(g.x)));
    col += mix(vec3(0.7, 0.76, 0.86), warm, heat) * lit * (0.08 + 0.8 * vGlow) * uGlyph;
  } else {
    vec3 Ls = normalize(-vW);
    float irr = max(dot(N, Ls), 0.0) * 1.6 / (1.0 + dot(vW, vW) * 0.3); // starlight falls off with radius: inner shells run hotter
    col = vec3(0.95, 0.6, 0.27) * (0.02 + irr * (0.03 + 0.6 * heat * heat)) + vec3(1.0, 0.85, 0.65) * pow(max(dot(R, Ls), 0.0), 60.0) * 0.4;
    col += warm * seam * (0.05 + 0.6 * heat);
  }
  col += vec3(0.98, 0.9, 0.78) * min(vGlow, 1.0) * (0.3 + 1.0 * seam); // the data wave's front: lit seams, not a lit plate
  gl_FragColor = vec4(clamp(col, 0.0, 3.0), 1.0);
}`;

const STRUT_VS = /* glsl */ `
attribute float aE; // 0: this panel, 1: its lane neighbour, 2: this panel, 3: tether down to the next shell
uniform float uStrut; varying vec3 vC;
${COMMON}
void main() {
  vec3 d, T; lane(aE > 0.5 && aE < 1.5 ? aRnd.w : 0.0, d, T);
  int si = int(aLane.z + 0.5);
  float R = uR[si] * 0.992; // just under the panels: seen between them and through open louvers
  if (aE > 2.5) R = (si < ${NS - 1} && fract(aRnd.x * 13.0) < 0.2) ? uR[si < ${NS - 1} ? si + 1 : si] * 1.01 : R;
  float heat = pow(aLane.z / 3.0, 1.5);
  vC = mix(vec3(0.5, 0.54, 0.62), vec3(1.0, 0.6, 0.28), heat) * uStrut * (aE > 1.5 ? 0.6 : 1.0);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(d * R, 1.0);
}`;
const STRUT_FS = /* glsl */ `varying vec3 vC; void main() { gl_FragColor = vec4(clamp(vC, 0.0, 1.0), 1.0); }`;

/** The star seen through the gaps: a warm photosphere glow inside the innermost shell (depth-tested, so only gaps show it). */
const GLOW_VS = /* glsl */ `varying vec2 vP; void main() { vP = position.xy * 2.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy * 3.4; gl_Position = projectionMatrix * mv; }`;
const GLOW_FS = /* glsl */ `uniform float uGain; varying vec2 vP;
void main() { float r = length(vP);
  vec3 c = vec3(1.0, 0.62, 0.3) * exp(-r * 4.5) * 0.9 + vec3(1.0, 0.85, 0.65) * exp(-r * r * 60.0) * 0.6;
  gl_FragColor = vec4(clamp(c * uGain * (1.0 - smoothstep(0.8, 1.0, r)), 0.0, 2.0), 1.0); }`;

function panelGeo(lay: ReturnType<typeof layout>) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(21), 3)); // placed in the shader
  g.setAttribute("aK", new THREE.Float32BufferAttribute([-1, 0, 1, 2, 3, 4, 5], 1));
  g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 6, 0, 6, 1]);
  g.setAttribute("aLane", new THREE.InstancedBufferAttribute(lay.lane, 4));
  g.setAttribute("aRnd", new THREE.InstancedBufferAttribute(lay.rnd, 4));
  g.instanceCount = lay.n;
  return g;
}
function strutGeo(lay: ReturnType<typeof layout>) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(12), 3));
  g.setAttribute("aE", new THREE.Float32BufferAttribute([0, 1, 2, 3], 1));
  g.setAttribute("aLane", new THREE.InstancedBufferAttribute(lay.lane, 4));
  g.setAttribute("aRnd", new THREE.InstancedBufferAttribute(lay.rnd, 4));
  g.instanceCount = lay.n;
  return g;
}

const ZID = PLANETS.map((_, i) => (i * 0.618034) % 1); // Filaments' per-pair arc constant (CORE pairs come first)

export function Swarm({ live, reduced, level, busy, positions, pulses }: {
  live: RefObject<CoreLive>; reduced: boolean; level: number; busy: boolean;
  positions?: Record<string, THREE.Vector3>; pulses?: RefObject<Record<string, number>>;
}) {
  const lv = Math.max(0, Math.min(3, level | 0));
  const u = useMemo(() => ({
    uTime: { value: 0 }, uPhase: { value: 0 }, uGap: { value: 1 }, uGlyph: { value: 1 }, uStrut: { value: 0 },
    uR: { value: SHELLS.map((s) => s.r) }, uW: { value: SHELLS.map((s) => s.w) },
    uAx: { value: SHELLS.map((s) => new THREE.Vector3(...s.ax).normalize()) },
    uWaveA: { value: new THREE.Vector4(0, 0, 0, 99) }, uWaveB: { value: new THREE.Vector4(0, 0, 0, 99) },
    uHole: { value: Array.from({ length: NS * NH }, () => new THREE.Vector3()) }, uHoleG: { value: new Array<number>(NH).fill(0) },
  }), []);
  const glowU = useMemo(() => ({ uGain: { value: 1 } }), []);
  const { near, far, struts, mats } = useMemo(() => {
    const ln = layout(NEAR[lv]), lf = layout(FAR[lv]);
    const panel = new THREE.ShaderMaterial({ vertexShader: PANEL_VS, fragmentShader: PANEL_FS, uniforms: u, side: THREE.DoubleSide, toneMapped: false });
    const strut = new THREE.ShaderMaterial({ vertexShader: STRUT_VS, fragmentShader: STRUT_FS, uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const glow = new THREE.ShaderMaterial({ vertexShader: GLOW_VS, fragmentShader: GLOW_FS, uniforms: glowU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    return { near: panelGeo(ln), far: panelGeo(lf), struts: lv >= 1 ? strutGeo(ln) : null, mats: { panel, strut, glow } };
  }, [lv, u, glowU]);
  const quad = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => { near.dispose(); far.dispose(); struts?.dispose(); mats.panel.dispose(); mats.strut.dispose(); mats.glow.dispose(); }, [near, far, struts, mats]);
  useEffect(() => () => quad.dispose(), [quad]);

  const nearM = useRef<THREE.Mesh>(null), farM = useRef<THREE.Mesh>(null), strutM = useRef<THREE.LineSegments>(null);
  const st = useRef({ phase: 0, rate: 1, isNear: true });
  const tmp = useMemo(() => ({ m: new THREE.Vector3(), p: new THREE.Vector3() }), []);

  useFrame(({ clock, camera }, dt) => {
    const S = st.current, t = reduced ? 12 : clock.elapsedTime, dist = camera.position.length(), k = coreScale(dist);
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    const g = Math.min(1, Math.max(0, live.current?.g ?? 0));
    S.rate += ((busy ? 2.2 : 1) - S.rate) * (1 - Math.exp(-step * 1.5)); // thinking: the shells spin up, smoothly
    if (!reduced) S.phase = (S.phase + step * S.rate) % 1e5;
    u.uTime.value = t; u.uPhase.value = reduced ? 0 : S.phase;
    S.isNear = S.isNear ? dist < 24 : dist < 21; // hysteresis: no flicker at the swap distance
    if (nearM.current) nearM.current.visible = S.isNear;
    if (farM.current) farM.current.visible = !S.isNear;
    const strut = Math.min(1, Math.max(0, (16 - dist) / 8)); // hairline lattice only up close
    u.uStrut.value = strut * 0.2;
    if (strutM.current) strutM.current.visible = S.isNear && strut > 0.01;
    u.uGlyph.value = 1 + 1.5 * g;
    glowU.uGain.value = 0.8 + 0.6 * g + (busy ? 0.25 : 0);

    // apertures: where each planet's filament (a Bezier from the CORE, see Filaments) crosses each shell
    const now = Date.now(); let newest = -1, newestAge = 1e9;
    for (let i = 0; i < NH; i++) {
      const id = PLANETS[i].id, B = positions?.[id], L = B ? B.length() : 0;
      const pg = 1 - (now - (pulses?.current?.[id] ?? 0)) / 3000;
      u.uHoleG.value[i] = pg > 0 && pg <= 1 ? pg : 0;
      if (pg > 0 && pg <= 1 && (1 - pg) * 3 < newestAge) { newestAge = (1 - pg) * 3; newest = i; }
      for (let s = 0; s < NS; s++) {
        const h = u.uHole.value[s * NH + i];
        if (!B || !(L > 1e-3)) { h.set(0, 0, 0); continue; }
        const z = ZID[i], M = tmp.m.copy(B).multiplyScalar(0.5);
        M.y += (0.12 + 0.12 * z) * L * (z > 0.5 ? 1 : -1);
        const Rw = SHELLS[s].r * k, ml = Math.max(M.length(), 1e-3);
        let tt = Math.min(1, Rw / (2 * ml));
        for (let it = 0; it < 2; it++) { // p(t) = 2(1-t)t M + t^2 B: refine t so |p| = Rw
          tmp.p.copy(M).multiplyScalar(2 * (1 - tt) * tt).addScaledVector(B, tt * tt);
          const pl = tmp.p.length();
          if (pl > 1e-4) tt = Math.min(1, tt * Rw / pl);
        }
        tmp.p.copy(M).multiplyScalar(2 * (1 - tt) * tt).addScaledVector(B, tt * tt);
        if (tmp.p.lengthSq() > 1e-8) h.copy(tmp.p).normalize(); else h.set(0, 0, 0);
      }
    }
    // data waves: A = the CORE thinking (an event ripples out from the side facing you; busy = a wave every 3.2 s),
    // B = the newest backend event on a planet, spreading from that planet's aperture
    const A = u.uWaveA.value, W = u.uWaveB.value;
    if (reduced) { A.w = 99; W.w = 99; return; }
    if (g > 0) { const c = camera.position; A.set(c.x, c.y, c.z, 0).normalize(); A.w = (1 - g) * 3; }
    else if (busy) {
      const n = Math.floor(t / 3.2), ph = n * 2.39996, y = ((n * 0.618034) % 1) * 1.4 - 0.7, rr = Math.sqrt(1 - y * y);
      const c = camera.position, cl = Math.max(c.length(), 1e-3);
      A.set(c.x / cl + Math.cos(ph) * rr * 0.9, c.y / cl + y * 0.9, c.z / cl + Math.sin(ph) * rr * 0.9, 0).normalize();
      A.w = t % 3.2;
    } else A.w = 99;
    if (newest >= 0) { const h = u.uHole.value[newest]; W.set(h.x, h.y, h.z, newestAge); } else W.w = 99;
  });

  return (
    <group>
      <mesh geometry={quad} material={mats.glow} frustumCulled={false} renderOrder={1} />
      <mesh ref={nearM} geometry={near} material={mats.panel} frustumCulled={false} />
      <mesh ref={farM} geometry={far} material={mats.panel} frustumCulled={false} visible={false} />
      {struts && <lineSegments ref={strutM} geometry={struts} material={mats.strut} frustumCulled={false} />}
    </group>
  );
}
