"use client";
// MEMORY world: every memory is a star. Positions come from /api/memories/map (server-side layout from embeddings),
// links are faint threads, CORE-learned memories carry a ring. The one calm surface on the right (MemoryShell) holds the
// main job: find or remember, Needs you, Recent; a memory, the map options, the timeline and people open in its sheet.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ComponentType } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type RootState, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stars, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping, SMAA } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useGlRecovery } from "./useGlRecovery";
import type { MemoryPanel } from "./panels"; // passed in by Orbit: the public demo must not bundle panels (Supabase client)
import { beliefsPending, takeBeliefsRequest } from "./BeliefsPanel";
import { studyPending } from "./StudyCards";
import type { QualityMode } from "@/lib/quality-pure";
import { useLeanQuality } from "./useLeanQuality";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { centroid, connections, isLearned, searchStars, starProjects, subgraph } from "@/lib/memory-world-pure";
import { kindColor, normMap, type Star } from "@/lib/memory-planet-pure";
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n-core-pure";
import { DAY, edgeBorn, edgeGlow } from "@/lib/memory-edges-pure";
import { useAlienEnv } from "./alien/env";
import { ClusterHalos } from "./MemoryClusters";
import type { Graph } from "@/lib/memory-graph-pure";
import { useMountLater, WarmCompile } from "./WarmCompile";
import { smoothDampVec } from "@/lib/smooth-damp-pure";
import { PeoplePanel, usePeople } from "./PeopleRing";
import { MEMORY_SHEET_EVENT, MemoryShell } from "./MemoryShell";
import { Button } from "./ui";
import dynamic from "next/dynamic";
import { ChipLayer, ChipProjector, Crystals, Motes, PlanetGround, WorldLights, useChipRig, type Chip } from "./world-kit";
import { memoryClusters } from "@/lib/planet-scenes-pure";
import { memoryCity } from "@/lib/worlds-v3-pure";

const Chronicle = dynamic(() => import("./Chronicle"), { ssr: false }); // its own canvas, loaded only when he opens Chronicle

type MapData = { items: Star[]; links: { from: string; to: string }[]; edges?: [number, number, number][]; total: number; graph?: Graph | null };

const BG = "#020308";
const WEB = new THREE.Color("#a5b4fc"); // similarity web
const PEARL = new THREE.Color("#dfe8ff"), PEARL_RGB = [PEARL.r, PEARL.g, PEARL.b]; // dust and sparks: pearl / blue-white, only a hint of the kind colour
const REPLAY_TICKS = 120, REPLAY_MS = 80, REPLAY_TICKS_REDUCED = 8, REPLAY_MS_REDUCED = 700; // ~10 s replay; reduced motion jumps in a few steps

// Depth of field without a post pass: points away from the focus distance (camera -> orbit target) grow and soften
// like bokeh, keeping roughly the same light. Shared by stars and dust; vBlur is 0 in focus, 1 fully out.
const DOF = /* glsl */ `uniform float uFocus;
  float blurAt(float d) { return clamp(abs(d - uFocus) / max(uFocus * 0.9, 1.0) - 0.15, 0.0, 1.0); }
  // Sub-pixel points shimmer as they cross pixel centres: hold a minimum size and fade light by the lost area instead.
  float coverage(inout float px, float lo) { float k = clamp(px / lo, 0.0, 1.0); px = max(px, lo); return k * k; }`;
const vert = /* glsl */ `
  attribute vec3 aColor; attribute float aGlow; attribute float aHi; attribute float aBorn;
  uniform float uTime; uniform float uScale; uniform float uMotion; uniform float uAt;
  varying vec3 vColor; varying float vGlow; varying float vHi; varying float vBlur; varying float vPx; varying float vCov;
  ${DOF}
  void main() {
    if (aBorn > uAt) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // not yet saved at the replayed moment
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(-mv.z, 0.5);
    float tw = 1.0 + uMotion * 0.05 * sin(uTime * 0.7 + position.x * 3.1 + position.y * 1.7); // a slow breath, not a twinkle
    vBlur = blurAt(d) * (1.0 - aHi);
    float px = min(0.8 * (1.0 + aGlow * 0.25 + aHi * 1.1) * (1.0 + vBlur * 1.6) * tw * uScale / d, 96.0);
    vCov = coverage(px, 3.0);
    gl_PointSize = px; vPx = px;
    gl_Position = projectionMatrix * mv;
    vColor = aColor; vGlow = aGlow; vHi = aHi;
  }`;
const frag = /* glsl */ `
  uniform float uSearch;
  varying vec3 vColor; varying float vGlow; varying float vHi; varying float vBlur; varying float vPx; varying float vCov;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    // the core never gets thinner than ~0.7 px (no shimmer); glint and ring only once the star is big enough to carry them
    float core = exp(-r2 * min(mix(16.0, 3.0, vBlur), vPx * vPx * 0.25)), halo = exp(-r2 * 4.0) * 0.4 * (1.0 - vBlur);
    float near = smoothstep(10.0, 22.0, vPx);
    float flare = (exp(-abs(p.x) * 40.0) + exp(-abs(p.y) * 40.0)) * exp(-r2 * 6.0) * 0.18 * (1.0 - vBlur) * near; // a faint four-point glint
    float ring = vGlow * smoothstep(0.1, 0.0, abs(sqrt(r2) - 0.7)) * 0.5 * (1.0 - vBlur) * smoothstep(6.0, 12.0, vPx); // CORE-learned: a thin orbit ring
    float dim = mix(1.0, 0.18, uSearch * (1.0 - vHi)) / (1.0 + vBlur * 2.2);
    vec3 c = vColor * (core * 1.2 + halo + ring + flare) + vec3(core * (0.3 + vHi * 0.55));
    gl_FragColor = vec4(clamp(c * dim * vCov, 0.0, 2.0), 1.0);
  }`;
// Neural dust around every star: overlapping clouds make dense clusters glow. Born with its star in a replay.
const dustVert = /* glsl */ `
  attribute vec3 aColor; attribute float aBorn; attribute float aSeed;
  uniform float uTime; uniform float uScale; uniform float uMotion; uniform float uAt; uniform float uSearch;
  varying vec3 vColor; varying float vBlur;
  ${DOF}
  void main() {
    if (aBorn > uAt) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 p = position + uMotion * 0.16 * vec3(sin(uTime * 0.13 + aSeed * 40.0), sin(uTime * 0.11 + aSeed * 71.0), sin(uTime * 0.09 + aSeed * 97.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float d = max(-mv.z, 0.5);
    vBlur = blurAt(d);
    float px = min((0.045 + 0.045 * fract(aSeed * 13.0)) * (1.0 + vBlur * 1.5) * uScale / d, 20.0);
    float cov = coverage(px, 2.0);
    gl_PointSize = px;
    gl_Position = projectionMatrix * mv;
    vColor = aColor * (0.45 + 0.55 * fract(aSeed * 7.0)) * mix(1.0, 0.25, uSearch) * cov;
  }`;
const dustFrag = /* glsl */ `
  varying vec3 vColor; varying float vBlur;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float a = max(1.0 - dot(p, p), 0.0);
    gl_FragColor = vec4(clamp(vColor * a * a * 0.3 / (1.0 + vBlur * 2.5), 0.0, 0.6), 1.0);
  }`;
// The similarity web as luminous filaments: each edge fades between its two kinds' colours, a light pulse runs along it.
const webVert = /* glsl */ `
  attribute float aT; attribute float aSeed; varying vec3 vC; varying float vT; varying float vS;
  void main() { vC = color; vT = aT; vS = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PULSE = /* glsl */ `
  uniform float uTime;
  float headAt(float s) { float h = fract(uTime * (0.07 + 0.1 * s) + s * 7.0); return s > 0.5 ? 1.0 - h : h; } // half run each way
  float carries(float s) { return step(0.45, fract(s * 13.7)); } // about half the threads carry a pulse`;
const webFrag = /* glsl */ `
  varying vec3 vC; varying float vT; varying float vS;
  ${PULSE}
  void main() {
    float d = (vT - headAt(vS)) * (vS > 0.5 ? 1.0 : -1.0); // > 0 behind the head
    float pulse = carries(vS) * (d >= 0.0 ? exp(-d * 14.0) : exp(-d * d * 3000.0));
    gl_FragColor = vec4(clamp(vC * (0.2 + pulse * 1.4) + vec3(pulse * dot(vC, vec3(0.3))), 0.0, 1.2), 1.0);
  }`;
const sparkVert = /* glsl */ `
  attribute vec3 aB; attribute vec3 aColor; attribute float aSeed; uniform float uScale; varying vec3 vC;
  ${PULSE}
  void main() {
    vec4 mv = modelViewMatrix * vec4(mix(position, aB, headAt(aSeed)), 1.0);
    float on = carries(aSeed) * step(0.001, dot(aColor, vec3(1.0))); // unborn (black) edges carry nothing
    float px = min(0.2 * uScale / max(-mv.z, 0.5), 14.0);
    float k = clamp(px / 2.0, 0.0, 1.0); px = max(px, 2.0); // coverage fade instead of sub-pixel flicker
    vC = aColor * k * k;
    gl_PointSize = on * px;
    gl_Position = projectionMatrix * mv;
  }`;
const sparkFrag = /* glsl */ `
  varying vec3 vC;
  void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float a = max(1.0 - dot(p, p), 0.0);
    gl_FragColor = vec4(clamp(vC * 1.3 * a * a * a, 0.0, 1.2), 1.0); }`;

/** v3: the memories as a crystal city on a planet under the star map: one district per kind on its own plateau, a spire at the
 *  weighted centre, glowing threads from each district to the spire and its nearest neighbours. ~6 draw calls in all. */
function MemoryGround({ items, reduced }: { items: Star[]; reduced: boolean }) {
  const { clusters, ground } = useMemo(() => memoryClusters(items), [items]);
  const city = useMemo(() => memoryCity(clusters, ground), [clusters, ground]);
  const crystals = useMemo(() => [
    ...clusters.flatMap((c) => { const col = new THREE.Color(kindColor(c.kind)).lerp(new THREE.Color("#7c3aed"), 0.55).lerp(new THREE.Color("#f59e0b"), 0.12).getStyle();
      return c.crystals.map((k, i) => ({ at: [k.at[0], ground + 0.5, k.at[2]] as [number, number, number], h: k.h * 0.8, w: k.h * 0.26, tilt: k.tilt, color: col, glow: i ? 1 : 1.7 })); }),
    { at: [city.spire.x, ground + 0.6, city.spire.z] as [number, number, number], h: city.spire.h, w: city.spire.h * 0.22, color: "#c084fc", glow: 2 },
    ...city.crown.map((k) => ({ at: [k.at[0], ground + 0.6, k.at[2]] as [number, number, number], h: k.h, w: k.h * 0.28, color: "#a855f7", glow: 1.3 })),
  ], [clusters, ground, city]);
  const threads = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(city.threads.flat(2), 3)); return g; }, [city]);
  const plates = useRef<THREE.InstancedMesh>(null), rings = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => { const o = new THREE.Object3D();
    city.plateaus.forEach((p, i) => { o.position.set(p.x, ground + 0.2, p.z); o.rotation.set(0, i, 0); o.scale.set(p.r, 0.6, p.r); o.updateMatrix(); plates.current?.setMatrixAt(i, o.matrix);
      o.position.set(p.x, ground + 0.52, p.z); o.rotation.set(-Math.PI / 2, 0, 0); o.scale.set(p.r * 1.02, p.r * 1.02, 1); o.updateMatrix(); rings.current?.setMatrixAt(i, o.matrix); });
    for (const m of [plates.current, rings.current]) if (m) { m.count = city.plateaus.length; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); } }, [city, ground]);
  useEffect(() => () => threads.dispose(), [threads]);
  const n = Math.max(1, city.plateaus.length);
  return (<group>
    <group position={[0, ground, 0]}><PlanetGround glow="#8b5cf6" a="#07050f" b="#1a1230" R={140} /></group>
    <instancedMesh ref={plates} args={[undefined, undefined, n]}><cylinderGeometry args={[1, 1.15, 1, 9]} /><meshStandardMaterial color="#1c1530" roughness={0.85} flatShading /></instancedMesh>
    <instancedMesh ref={rings} args={[undefined, undefined, n]}><ringGeometry args={[0.94, 1, 48]} /><meshBasicMaterial color={new THREE.Color("#c4b5fd").multiplyScalar(1.6)} toneMapped={false} /></instancedMesh>
    <lineSegments geometry={threads}><lineBasicMaterial color={new THREE.Color("#a78bfa").multiplyScalar(2)} transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} /></lineSegments>
    <mesh position={[city.spire.x, ground + 0.35, city.spire.z]} rotation-x={-Math.PI / 2}><ringGeometry args={[2.3, 2.45, 64]} /><meshBasicMaterial color={new THREE.Color("#e9d5ff").multiplyScalar(1.8)} toneMapped={false} /></mesh>
    <pointLight position={[city.spire.x, ground + city.spire.h * 0.7, city.spire.z]} intensity={40} distance={26} decay={1.5} color="#e9b8ff" />
    <Crystals items={crystals} reduced={reduced} intensity={1.5} />
    <group position={[0, ground, 0]}><Motes count={reduced ? 120 : 320} color="#c4b5fd" spread={30} height={10} reduced={reduced} /></group>
  </group>);
}

/** Faint obsidian rings far behind the constellation, turning very slowly: the megastructure the memories live in. */
const FAR_RINGS = [{ r: 16, spin: 0.02 }, { r: 26, spin: -0.014 }, { r: 38, spin: 0.01 }, { r: 52, spin: -0.007 }, { r: 68, spin: 0.005 }] as const;
function FarRings({ reduced }: { reduced: boolean }) {
  const env = useAlienEnv();
  const geos = useMemo(() => FAR_RINGS.map((k) => new THREE.TorusGeometry(k.r, 0.35 + k.r * 0.006, 4, 192)), []);
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#030305", metalness: 0.9, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05,
    iridescence: 0.4, iridescenceThicknessRange: [200, 600], flatShading: true, emissive: "#1a2a55", emissiveIntensity: 0.05, envMapIntensity: 0.25 }), []);
  useEffect(() => { mat.envMap = env; mat.needsUpdate = true; }, [mat, env]);
  useEffect(() => () => { geos.forEach((g) => g.dispose()); mat.dispose(); }, [geos, mat]);
  const spin = useRef<(THREE.Mesh | null)[]>([]);
  useFrame((_, dt) => {
    if (reduced) return;
    const step = Math.min(Math.max(dt, 0), 0.1);
    for (let i = 0; i < FAR_RINGS.length; i++) { const m = spin.current[i]; if (m) m.rotation.z += step * FAR_RINGS[i].spin; }
  });
  return <group position={[30, 45, -230]} rotation={[0.15, 0.2, 0]}>{FAR_RINGS.map((k, i) => ( // concentric, off to one side, far behind
    <mesh key={i} ref={(el) => { spin.current[i] = el; }} geometry={geos[i]} material={mat} rotation={[0.08 * i, -0.06 * i, 0]} scale={[1, 1, 4]} raycast={() => null} />))}</group>;
}

function Constellation({ data, at, hi, searching, reduced, lite, onHover, onPick }: {
  data: MapData; at: number | null; hi: Set<number>; searching: boolean; reduced: boolean; lite: boolean; onHover: (i: number | null) => void; onPick: (i: number) => void;
}) {
  const { size, camera, gl } = useThree();
  const times = useMemo(() => created(data.items), [data]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry(), n = data.items.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), glow = new Float32Array(n), c = new THREE.Color();
    const born = new Float32Array(n); // days since the oldest memory: float32 keeps day precision, raw ms would not
    data.items.forEach((m, i) => {
      pos.set([m.x, m.y, m.z], i * 3);
      born[i] = (times.at[i] - times.t0) / DAY;
      c.set(kindColor(m.kind)); col.set([c.r, c.g, c.b], i * 3);
      glow[i] = isLearned(m.source) ? 1 : 0;
    });
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aGlow", new THREE.BufferAttribute(glow, 1));
    g.setAttribute("aHi", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("aBorn", new THREE.BufferAttribute(born, 1));
    g.computeBoundingSphere();
    return g;
  }, [data, times]);
  const lines = useMemo(() => {
    const at = new Map(data.items.map((m, i) => [m.id, i])), pos: number[] = [];
    for (const l of data.links) {
      const a = data.items[at.get(l.from)!], b = data.items[at.get(l.to)!];
      if (a && b) pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [data]);
  const web = useMemo(() => { // the similarity web: one LineSegments + one spark per edge, colours repainted only when the moment changes
    const e = data.edges ?? [], n = e.length, pos = new Float32Array(n * 6), born = new Float64Array(n), c = new THREE.Color();
    const t = new Float32Array(n * 2), seed = new Float32Array(n * 2), kc = new Float32Array(n * 6), a3 = new Float32Array(n * 3), b3 = new Float32Array(n * 3), s1 = new Float32Array(n);
    e.forEach(([a, b], k) => {
      const s = Math.abs(Math.sin(k * 12.9898 + 4.1) * 43758.5453) % 1;
      t[k * 2 + 1] = 1; seed[k * 2] = seed[k * 2 + 1] = s1[k] = s;
      const p = data.items[a], q = data.items[b];
      if (!p || !q) { born[k] = Infinity; return; }
      pos.set([p.x, p.y, p.z, q.x, q.y, q.z], k * 6);
      a3.set([p.x, p.y, p.z], k * 3); b3.set([q.x, q.y, q.z], k * 3);
      c.set(kindColor(p.kind)).lerp(WEB, 0.3); kc.set([c.r, c.g, c.b], k * 6);
      c.set(kindColor(q.kind)).lerp(WEB, 0.3); kc.set([c.r, c.g, c.b], k * 6 + 3);
      born[k] = edgeBorn(times.at[a], times.at[b]);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    g.setAttribute("aT", new THREE.BufferAttribute(t, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const sparks = new THREE.BufferGeometry();
    sparks.setAttribute("position", new THREE.BufferAttribute(a3, 3));
    sparks.setAttribute("aB", new THREE.BufferAttribute(b3, 3));
    sparks.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    sparks.setAttribute("aSeed", new THREE.BufferAttribute(s1, 1));
    return { g, sparks, born, kc, sim: e.map((x) => x[2]) };
  }, [data, times]);
  const dust = useMemo(() => { // a few motes per star, gaussian around it (deterministic)
    const per = lite ? 1 : 3, n = data.items.length * per, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), born = new Float32Array(n), seed = new Float32Array(n), c = new THREE.Color();
    let s = 11;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
    data.items.forEach((m, i) => {
      c.set(kindColor(m.kind)).lerp(PEARL, 0.8);
      for (let j = 0; j < per; j++) {
        const k = i * per + j, r = 0.5 + rnd() * 1.4;
        pos.set([m.x + gauss() * r, m.y + gauss() * r, m.z + gauss() * r], k * 3);
        col.set([c.r, c.g, c.b], k * 3); born[k] = (times.at[i] - times.t0) / DAY; seed[k] = rnd();
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aBorn", new THREE.BufferAttribute(born, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.computeBoundingSphere();
    return g;
  }, [data, times, lite]);
  const now = at ?? times.now;
  useEffect(() => {
    const a = web.g.getAttribute("color") as THREE.BufferAttribute, arr = a.array as Float32Array;
    const sa = web.sparks.getAttribute("aColor") as THREE.BufferAttribute, sp = sa.array as Float32Array, kc = web.kc;
    for (let k = 0; k < web.born.length; k++) {
      const v = edgeGlow(web.born[k], now, web.sim[k]);
      for (let j = 0; j < 6; j++) arr[k * 6 + j] = kc[k * 6 + j] * v;
      for (let j = 0; j < 3; j++) sp[k * 3 + j] = ((kc[k * 6 + j] + kc[k * 6 + 3 + j]) * 0.5 * 0.35 + PEARL_RGB[j] * 0.65) * v;
    }
    a.needsUpdate = true; sa.needsUpdate = true;
  }, [web, now]);
  useEffect(() => () => { geo.dispose(); lines.dispose(); web.g.dispose(); web.sparks.dispose(); }, [geo, lines, web]);
  useEffect(() => () => dust.dispose(), [dust]);
  const shown = (i: number) => times.at[i] <= now;
  // Highlights (hover, selection, matches) fade in and out over ~0.2 s instead of popping: aHi eases toward hiGoal.
  const hiGoal = useMemo(() => new Float32Array(data.items.length), [data]), hiMoving = useRef(false);
  useEffect(() => { hiGoal.fill(0); hi.forEach((i) => { hiGoal[i] = 1; }); hiMoving.current = true; }, [hiGoal, hi]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uScale: { value: 400 }, uMotion: { value: 0 }, uSearch: { value: 0 }, uAt: { value: 1e9 }, uFocus: { value: 46 } }), []);
  const mats = useMemo(() => {
    const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms };
    return {
      web: new THREE.ShaderMaterial({ ...add, vertexShader: webVert, fragmentShader: webFrag, vertexColors: true }),
      sparks: new THREE.ShaderMaterial({ ...add, vertexShader: sparkVert, fragmentShader: sparkFrag }),
      dust: new THREE.ShaderMaterial({ ...add, vertexShader: dustVert, fragmentShader: dustFrag }),
    };
  }, [uniforms]);
  useEffect(() => () => { mats.web.dispose(); mats.sparks.dispose(); mats.dust.dispose(); }, [mats]);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { invalidate(); }, [hi, searching, at, data, invalidate]); // reduced motion renders on demand: draw once per change
  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1), k = reduced ? 1 : 1 - Math.exp(-dt * 14);
    if (hiMoving.current) {
      const a = geo.getAttribute("aHi") as THREE.BufferAttribute, arr = a.array as Float32Array;
      let moving = false;
      for (let i = 0; i < arr.length; i++) {
        const g = hiGoal[i], d = g - arr[i];
        if (d === 0) continue;
        arr[i] = Math.abs(d) < 0.01 ? g : arr[i] + d * k;
        moving ||= arr[i] !== g;
      }
      a.needsUpdate = true; hiMoving.current = moving;
    }
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    uniforms.uTime.value = reduced ? 3 : clock.elapsedTime % 1000; // bounded: keeps sin() precise; reduced holds pulses still
    uniforms.uScale.value = (size.height * gl.getPixelRatio()) / (2 * Math.tan((fov * Math.PI) / 360));
    uniforms.uMotion.value = reduced ? 0 : 1;
    uniforms.uSearch.value += ((searching ? 1 : 0) - uniforms.uSearch.value) * k; // the search dim fades too
    uniforms.uAt.value = at === null ? 1e9 : (at - times.t0) / DAY;
    const f = controls ? camera.position.distanceTo(controls.target) : camera.position.length();
    if (Number.isFinite(f)) uniforms.uFocus.value += (Math.max(f, 1) - uniforms.uFocus.value) * (reduced ? 1 : 1 - Math.exp(-dt * 6)); // focus pulls, never steps
  });
  return <>
    <WarmCompile world="memory-data" /> {/* arrives with the data, after the canvas's own warm-up: its shaders compile in parallel too */}
    <lineSegments geometry={web.g} material={mats.web} raycast={() => null} />
    {!reduced && <points geometry={web.sparks} material={mats.sparks} raycast={() => null} frustumCulled={false} />}
    <points geometry={dust} material={mats.dust} raycast={() => null} />
    <lineSegments geometry={lines} raycast={() => null} visible={at === null}>
      <lineBasicMaterial color="#7dd3fc" transparent opacity={0.1} blending={THREE.AdditiveBlending} depthWrite={false} />
    </lineSegments>
    <points geometry={geo}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); if (e.index != null && shown(e.index)) onHover(e.index); }}
      onPointerOut={() => onHover(null)}
      onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (e.index != null && shown(e.index)) onPick(e.index); }}>
      <shaderMaterial vertexShader={vert} fragmentShader={frag} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  </>;
}

/** created_at as ms per star, plus the oldest one and the load moment ("now" when not replaying). */
function created(items: Star[]) {
  const now = Date.now(), raw = items.map((m) => (m.created_at ? Date.parse(m.created_at) : NaN));
  let t0 = now;
  for (const t of raw) if (Number.isFinite(t) && t < t0) t0 = t; // no spread: 2000 args is fine, but a missing date must not pull t0 to 1970
  return { at: raw.map((t) => (Number.isFinite(t) ? t : t0)), t0, now }; // undated stars count as the oldest
}

/** Eases OrbitControls' target and the camera distance toward `goal`; jumps when reduced. Shifts the view left of the side panel. */
function Fly({ goal, reduced, shift }: { goal: { at: [number, number, number]; dist: number; n: number } | null; reduced: boolean; shift: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const size = useThree((s) => s.size);
  const active = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { active.current = !!goal; invalidate(); }, [goal, invalidate]);
  useEffect(() => { // centre the stars in the space left of the surface (half its width + margin)
    if (size.width >= 900 && shift > 0) camera.setViewOffset(size.width, size.height, shift, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix(); invalidate();
  }, [camera, size, shift, invalidate]);
  const to = useMemo(() => new THREE.Vector3(), []), dir = useMemo(() => new THREE.Vector3(), []), want = useMemo(() => new THREE.Vector3(), []);
  const vT = useMemo(() => new THREE.Vector3(), []), vP = useMemo(() => new THREE.Vector3(), []); // spring velocities: a re-target curves, never jerks
  useEffect(() => { if (!goal) { vT.set(0, 0, 0); vP.set(0, 0, 0); } }, [goal, vT, vP]);
  useFrame((_, dt) => {
    if (!goal || !controls || !active.current) { vT.set(0, 0, 0); vP.set(0, 0, 0); return; }
    to.set(...goal.at);
    dir.copy(camera.position).sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    want.copy(to).add(dir.normalize().multiplyScalar(goal.dist));
    if (reduced) { controls.target.copy(to); camera.position.copy(want); }
    else { const step = Math.min(dt, 0.1); smoothDampVec(controls.target, to, vT, 0.55, step); smoothDampVec(camera.position, want, vP, 0.55, step); }
    controls.update();
    if (!reduced) invalidate(); // demand mode (reduced motion) only draws when asked
    if (controls.target.distanceTo(to) < 0.01 && camera.position.distanceTo(want) < 0.02) active.current = false; // let the user orbit again
  });
  return null;
}

/** Places the DOM labels (sharp text, outside WebGL) on their stars every drawn frame: project to the canvas, hide behind the camera. */
function Projector({ items, labels, els }: { items: Star[]; labels: { i: number }[]; els: React.RefObject<Map<number, HTMLDivElement>> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const invalidate = useThree((st) => st.invalidate);
  useEffect(() => { invalidate(); }, [labels, invalidate]);
  useFrame(({ camera, size }) => {
    for (const l of labels) {
      const el = els.current?.get(l.i), m = items[l.i];
      if (!el || !m) continue;
      v.set(m.x, m.y, m.z).project(camera);
      const off = v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2;
      el.style.opacity = off ? "0" : "1";
      if (!off) el.style.transform = `translate3d(${Math.round((v.x * 0.5 + 0.5) * size.width) + 12}px, ${Math.round((-v.y * 0.5 + 0.5) * size.height)}px, 0) translateY(-50%)`;
    }
  });
  return null;
}

/** The open star's connections as precise lines (explicit links solid-bright, similar ones fainter), drawn over the web. */
function FocusLines({ items, from, to }: { items: Star[]; from: number | null; to: { i: number; kind: "explicit" | "inferred" }[] }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry(), a = from === null ? undefined : items[from], pos: number[] = [], col: number[] = [];
    if (a) for (const c of to) { const b = items[c.i]; if (!b) continue; const k = c.kind === "explicit" ? 0.95 : 0.45; pos.push(a.x, a.y, a.z, b.x, b.y, b.z); col.push(0.75 * k, 0.66 * k, k, 0.75 * k, 0.66 * k, k); }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [items, from, to]);
  useEffect(() => () => geo.dispose(), [geo]);
  const invalidate = useThree((st) => st.invalidate);
  useEffect(() => { invalidate(); }, [geo, invalidate]);
  return <lineSegments geometry={geo} raycast={() => null}><lineBasicMaterial vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} /></lineSegments>;
}

const MAP_SHIFT = 220; // the detail column sits on the right (≈ 440 px): centre the stars in the space left of it

export default function MemoryWorld({ onClose, reduced, flat, quality = "auto", focusId, onChanged, paused = false, List }: {
  onClose: () => void; reduced: boolean; flat?: boolean; quality?: QualityMode; focusId: string | null; onChanged: () => void; paused?: boolean /* kept mounted but hidden */;
  List?: ComponentType<ComponentProps<typeof MemoryPanel>>; // absent = read-only demo: no editing tools
}) {
  const glr = useGlRecovery();
  const later = useMountLater(); // the surface paints first; the WebGL context comes in the next task
  const q = useLeanQuality(quality);
  const { t, tn, lang } = useT();
  const [raw, setRaw] = useState<MapData | null>(null);
  const [err, setErr] = useState(false);
  const [reload, setReload] = useState(0);
  const [project, setProject] = useState(""); // MEM06: project-focused subgraph ("" = everything)
  const projects = useMemo(() => (raw ? starProjects(raw.items) : []), [raw]);
  const data = useMemo(() => (raw && project ? { ...raw, ...subgraph(raw.items, raw.edges, project), links: raw.links, graph: null } : raw), [raw, project]);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(focusId);
  const [goal, setGoal] = useState<{ at: [number, number, number]; dist: number; n: number } | null>(null);
  const [when, setWhen] = useState<number | null>(null); // replayed moment (ms); null = now
  const [playing, setPlaying] = useState(false);
  // Notes is the calm default (the canvas is not drawn behind it); Map shows the stars with the open memory beside them.
  const [mode, setMode] = useState<"notes" | "map">(List ? "notes" : "map");
  const [seenMap, setSeenMap] = useState(!List);
  useEffect(() => { if (mode === "map") setSeenMap(true); }, [mode]);
  const [river, setRiver] = useState(false), [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [peopleOn, setPeopleOn] = useState(false);
  const ppl = usePeople(peopleOn && !paused && !!List);
  const fly = useCallback((at: [number, number, number], dist: number) => setGoal((g) => ({ at, dist, n: (g?.n ?? 0) + 1 })), []);

  useEffect(() => { // (re)load the map: on entry, after a change, on Try again. Never while hidden.
    if (paused) return;
    let live = true;
    fetch("/api/memories/map").then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error(String(r.status));
      if (live) { setRaw(normMap(j) as MapData); setErr(false); }
    }).catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [paused, reload]);
  const changed = useCallback(() => { setReload((n) => n + 1); onChanged(); }, [onChanged]);
  const patched = useCallback((id: string, p: Partial<Star>) => setRaw((d) => d && { ...d, items: d.items.map((m) => (m.id === id ? { ...m, ...p } : m)) }), []);

  const index = useMemo(() => new Map(data?.items.map((m, i) => [m.id, i]) ?? []), [data]);
  const flyTo = useCallback((id: string) => { const i = index.get(id), m = i === undefined ? undefined : data?.items[i]; if (m) { setOpenId(id); setMode("map"); fly([m.x, m.y, m.z], 9); } }, [index, data, fly]);
  useEffect(() => { setHover(null); setWhen(null); setPlaying(false); }, [data]); // positions are array indexes: a refetch reorders them
  useEffect(() => { if (focusId) setOpenId(focusId); }, [focusId]); // palette, CORE or a link opened a memory
  useEffect(() => { // in the map, the open memory's star comes to the centre
    if (mode !== "map" || !openId) return;
    const i = index.get(openId), m = i === undefined ? undefined : data?.items[i];
    if (m) fly([m.x, m.y, m.z], 11);
  }, [openId, mode, index]); // eslint-disable-line react-hooks/exhaustive-deps -- once per opened memory / view switch
  useEffect(() => { // "what do you know about me" / "study" arrive as nav events and open the matching sheet
    const open = (k: "knows" | "all") => setTimeout(() => dispatchEvent(new CustomEvent(MEMORY_SHEET_EVENT, { detail: k })), 0);
    if (beliefsPending()) { takeBeliefsRequest(); open("knows"); }
    else if (studyPending() && List) open("all");
    const h = (e: Event) => { const d = (e as CustomEvent<NavTarget>).detail; if (d?.beliefs) { takeBeliefsRequest(); setMode("notes"); open("knows"); } else if (d?.study && List) { setMode("notes"); open("all"); } };
    addEventListener(NAV_EVENT, h);
    return () => removeEventListener(NAV_EVENT, h);
  }, [List]);

  const span = useMemo(() => (data ? created(data.items) : null), [data]);
  const spanDays = span ? Math.max(1, Math.ceil((span.now - span.t0) / DAY)) : 1;
  useEffect(() => { // replay: step the moment forward from the first memory to now
    if (!playing || !span) return;
    const ticks = reduced ? REPLAY_TICKS_REDUCED : REPLAY_TICKS, step = (span.now - span.t0) / ticks;
    const id = setInterval(() => setWhen((w) => {
      const next = (w ?? span.t0) + step;
      if (next >= span.now) { setPlaying(false); return null; }
      return next;
    }), reduced ? REPLAY_MS_REDUCED : REPLAY_MS);
    return () => clearInterval(id);
  }, [playing, span, reduced]);
  const play = () => { if (!span) return; if (playing) { setPlaying(false); return; } setWhen(span.t0); setPlaying(true); };
  const loc = lang === "et" ? "et-EE" : "en-GB";
  const whenLabel = when === null ? t("mp.map.live") : new Date(when).toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" });

  const hits = useMemo(() => (data && mode === "map" ? searchStars(data.items, query) : []), [data, query, mode]);
  useEffect(() => { // ease toward the matches as the query settles
    if (!data || !hits.length) return;
    const id = setTimeout(() => {
      const pts = hits.map((i) => data.items[i]), c = centroid(pts);
      const spread = Math.max(...pts.map((p) => Math.hypot(p.x - c[0], p.y - c[1], p.z - c[2])));
      fly(c, Math.min(48, Math.max(9, spread * 2.4)));
    }, 350);
    return () => clearTimeout(id);
  }, [hits, data, fly]);
  const sel = openId ? index.get(openId) ?? null : null;
  const near = useMemo(() => (data && sel !== null ? connections(sel, data.items, data.links, data.edges).slice(0, 6) : []), [data, sel]);
  const hi = useMemo(() => {
    const s = new Set(hits);
    if (hover !== null) s.add(hover);
    if (sel !== null) { s.add(sel); for (const c of near) s.add(c.i); }
    return s;
  }, [hits, hover, sel, near]);
  const pick = useCallback((i: number) => { const m = data?.items[i]; if (m) setOpenId(m.id); }, [data]);
  const kinds = useMemo(() => [...new Set(data?.items.map((m) => m.kind))].sort(), [data]);
  const kindName = (k: string) => { const v = t(`mp.k.${k}` as Key); return v === `mp.k.${k}` ? k.charAt(0).toUpperCase() + k.slice(1) : v; };
  const rig = useChipRig();
  const memChips = useMemo<Chip[]>(() => { if (!data) return []; const { clusters, ground } = memoryClusters(data.items);
    const sp = memoryCity(clusters, ground).spire;
    return [{ id: "all", at: [sp.x, ground + sp.h + 1.2, sp.z] as [number, number, number], title: t("w3.all" as Key), value: String(data.items.length), color: "#e9d5ff", prio: 30 },
      ...clusters.slice(0, 8).map((c, i) => ({ id: c.kind, at: [c.x, ground + 3.6, c.z] as [number, number, number], title: kindName(c.kind), value: tn("overview.memories", c.count), color: kindColor(c.kind), prio: 20 - i }))]; }, [data, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const onCreated = (s: RootState) => { glr.onCreated(s); s.raycaster.params.Points = { threshold: 0.45 }; };
  const labels = useMemo(() => { // the open star, its connections and the hovered one: precise labels drawn by Projector
    const out: { i: number; main: boolean }[] = [];
    if (sel !== null) out.push({ i: sel, main: true });
    for (const c of near) if (c.i !== hover) out.push({ i: c.i, main: false });
    if (hover !== null && hover !== sel) out.push({ i: hover, main: true });
    return out.filter((l) => !!data?.items[l.i]);
  }, [sel, near, hover, data]);
  const labelEls = useRef(new Map<number, HTMLDivElement>());

  const close = useCallback(() => onClose(), [onClose]);
  const retry = useCallback(() => { setErr(false); setRaw(null); setReload((n) => n + 1); }, []);
  const toMode = useCallback((m: "notes" | "map") => { setMode(m); if (m === "notes") setRiver(false); }, []);
  const peopleNode = useMemo(() => (List ? { node: <PeoplePanel st={ppl} />, count: ppl.people ? ppl.people.length : null, onOpen: () => setPeopleOn(true) } : undefined), [List, ppl]);
  const showMap = mode === "map" && !paused;
  const demand = reduced; // reduced motion: nothing moves on its own, so draw only when something changes
  const stats = raw ? [tn("overview.memories", raw.total || raw.items.length), raw.graph?.clusters.length ? tn("mp.stat.groups", raw.graph.clusters.length) : "",
    raw.links.length ? tn("mp.stat.links", raw.links.length) : "", raw.edges?.length ? t("mp.stat.similar", { n: raw.edges.length }) : ""].filter(Boolean) : [];

  return (
    <div role="region" className="absolute inset-0 globe-in mp-world" aria-label={t("mp.region")} style={{ background: BG }} data-mode={mode}>
      {showMap && river && <Chronicle reduced={reduced} quality={quality} paused={paused} slot={slot} />}
      {!flat && later && seenMap && !river && (
        <div className="mp-canvas" hidden={mode !== "map"}>
        <Canvas key={glr.key} onCreated={onCreated} frameloop={!showMap ? "never" : demand ? "demand" : "always"} camera={{ position: [0, 13, 44], fov: 50, near: 0.1, far: 400 }} dpr={[1, q.dpr]} gl={{ antialias: false }}
          onPointerMissed={() => setHover(null)} style={{ cursor: hover !== null ? "pointer" : undefined }}>
          {quality === "auto" && <PerformanceMonitor onDecline={q.onDecline} />}
          <WarmCompile world="memory" />
          <color attach="background" args={[BG]} />
          <Stars radius={120} depth={60} count={reduced ? 800 : Math.min(3000, q.stars)} factor={2.2} fade speed={reduced ? 0 : 0.2} />
          <FarRings reduced={reduced} />
          <WorldLights color="#8b5cf6" keyLight="#e9dcff" />
          {data && <MemoryGround items={data.items} reduced={reduced} />}
          {sel === null && !query.trim() && <ChipProjector rig={rig} chips={memChips} />}
          {data && <Constellation data={data} at={when} hi={hi} searching={!!query.trim()} reduced={reduced} lite={q.bloomScale === 0} onHover={setHover} onPick={pick} />}
          {data && <FocusLines items={data.items} from={sel} to={near} />}
          {data?.graph && !query.trim() && sel === null && <ClusterHalos graph={data.graph} items={data.items} />}
          {data && <Projector items={data.items} labels={labels} els={labelEls} />}
          <OrbitControls makeDefault enableDamping={!demand} dampingFactor={0.08} minDistance={3} maxDistance={110} autoRotate={!reduced && hover === null && sel === null} autoRotateSpeed={0.18} />
          <Fly goal={goal} reduced={reduced} shift={MAP_SHIFT} />
          {q.bloomScale > 0 && (
            <EffectComposer multisampling={q.msaa}>
              <Bloom intensity={(reduced ? 0.3 : 0.45) * q.bloomScale} luminanceThreshold={0.65} luminanceSmoothing={0.35} mipmapBlur />
              <Vignette offset={0.3} darkness={0.75} />
              <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
              {q.msaa ? <></> : <SMAA />}
            </EffectComposer>
          )}
        </Canvas>
        {sel === null && !query.trim() && <ChipLayer rig={rig} chips={memChips} />}
        <div className="mp-labels" aria-hidden="true">{labels.map((l) => { const m = data!.items[l.i]; return (
          <div key={`${m.id}-${l.main ? "m" : "n"}`} ref={(el) => { if (el) labelEls.current.set(l.i, el); else labelEls.current.delete(l.i); }} className="memory-star-label" data-main={l.main ? "" : undefined}>
            <b>{m.kind === "journal" ? t("mp.journal") : m.title}</b>{l.main && <span>{kindName(m.kind)}{isLearned(m.source) ? ` · ${t("mp.d.learned")}` : ""}</span>}</div>); })}</div>
        </div>
      )}

      {mode === "map" && <div className="pu mp-strip" data-planet="memory" role="group" aria-label={t("mp.map.title")}>
        <p className="mp-stats pu-num" aria-live="polite">{stats.map((x, i) => <span key={i}>{x}</span>)}</p>
        <div className="mp-strip-row">
          <div className="mp-seg" role="group" aria-label={t("mp.view")}>
            <button type="button" aria-pressed={!river} onClick={() => setRiver(false)}>{t("mp.map.stars")}</button>
            <button type="button" aria-pressed={river} onClick={() => setRiver(true)}>{t("mp.map.river")}</button>
          </div>
          {!river && span && data && data.items.length > 1 && <div className="mp-time" role="group" aria-label={t("mp.map.time")}>
            <Button size="sm" variant="ghost" onClick={play} aria-pressed={playing}>{playing ? t("mp.map.pause") : t("mp.map.replay")}</Button>
            <input type="range" min={0} max={spanDays} step={1} value={when === null ? spanDays : Math.round((when - span.t0) / DAY)} aria-label={t("mp.map.day")} aria-valuetext={whenLabel}
              onChange={(e) => { setPlaying(false); const d = Number(e.target.value); setWhen(d >= spanDays ? null : span.t0 + d * DAY); }} />
            <span className="mp-when" aria-live={playing ? "off" : "polite"}>{whenLabel}</span>
          </div>}
          {!river && projects.length > 0 && <select className="mp-input mp-proj" value={project} aria-label={t("mp.map.project")} onChange={(e) => { setProject(e.target.value); setQuery(""); }}>
            <option value="">{t("mp.map.all")}</option>{projects.map((p) => <option key={p}>{p}</option>)}</select>}
        </div>
        {river ? <div ref={setSlot} className="mp-river" /> : <ul className="mp-legend" aria-label={t("mp.map.legend")}>{kinds.map((k) => <li key={k}><i aria-hidden="true" style={{ background: kindColor(k) }} />{kindName(k)}</li>)}
          <li><i aria-hidden="true" className="mp-ring" />{t("mp.map.ring")}</li></ul>}
        {!river && <p className="mp-help">{t("mp.map.help")}</p>}
      </div>}

      <MemoryShell stars={raw?.items ?? null} links={raw?.links ?? []} edges={raw?.edges ?? []} total={raw?.total ?? 0} err={err && !raw} onRetry={retry}
        onQuery={setQuery} openId={openId} onOpen={setOpenId} onFly={flyTo} onChanged={changed} onPatched={patched}
        mode={mode} onMode={toMode} onClose={close} List={List} people={peopleNode} />
    </div>
  );
}
