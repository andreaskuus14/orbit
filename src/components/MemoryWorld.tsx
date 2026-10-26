"use client";
// MEMORY world: every memory is a star. Positions come from /api/memories/map (server-side layout from embeddings),
// links are faint threads, CORE-learned memories carry a ring. The list drawer lives on as "List view" in the side panel.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type RootState, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls, Stars, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping, SMAA } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useGlRecovery } from "./useGlRecovery";
import { MemoryPanel } from "./panels";
import { MemoryHygiene } from "./MemoryHygiene";
import { beliefsPending } from "./BeliefsPanel";
import type { QualityMode } from "@/lib/quality-pure";
import { useLeanQuality } from "./useLeanQuality";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { centroid, isLearned, searchStars } from "@/lib/memory-world-pure";
import { DAY, edgeBorn, edgeGlow } from "@/lib/memory-edges-pure";
import { useAlienEnv } from "./alien/env";
import { useMountLater, WarmCompile } from "./WarmCompile";
import { smoothDampVec } from "@/lib/smooth-damp-pure";
import { PeopleCanvas, PeoplePanel, usePeople } from "./PeopleRing";

type Star = { id: string; title: string; kind: string; tags: string[]; created_at: string; source: string | null; x: number; y: number; z: number };
type MapData = { items: Star[]; links: { from: string; to: string }[]; edges?: [number, number, number][]; total: number };

const BG = "#020308";
const KIND_COLOR: Record<string, string> = {
  note: "#9ec9ff", idea: "#ffd27a", link: "#7de3d0", document: "#c3b4ff", image: "#ff9ec7", research: "#7dc4ff",
  conversation: "#b8f0a8", project: "#ffb27a", preference: "#f0a8ff", decision: "#ff8f8f", goal: "#fff3a8",
};
const kindColor = (k: string) => KIND_COLOR[k] ?? "#a9b4c8";
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
  const at = items.map((m) => { const t = Date.parse(m.created_at); return Number.isFinite(t) ? t : 0; }), now = Date.now();
  return { at, t0: at.length ? Math.min(...at) : now, now };
}

/** Eases OrbitControls' target and the camera distance toward `goal`; jumps when reduced. Shifts the view left of the side panel. */
function Fly({ goal, reduced }: { goal: { at: [number, number, number]; dist: number; n: number } | null; reduced: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const size = useThree((s) => s.size);
  const active = useRef(false);
  useEffect(() => { active.current = !!goal; }, [goal]);
  useEffect(() => {
    if (size.width >= 900) camera.setViewOffset(size.width, size.height, 240, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size]);
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
    if (controls.target.distanceTo(to) < 0.01 && camera.position.distanceTo(want) < 0.02) active.current = false; // let the user orbit again
  });
  return null;
}

export default function MemoryWorld({ onClose, reduced, flat, quality = "auto", focusId, onChanged, paused = false }: {
  onClose: () => void; reduced: boolean; flat?: boolean; quality?: QualityMode; focusId: string | null; onChanged: () => void; paused?: boolean /* kept mounted but hidden */;
}) {
  const glr = useGlRecovery();
  const later = useMountLater(); // the panel paints first; the WebGL context and scene come in the next task
  const q = useLeanQuality(quality);
  const [data, setData] = useState<MapData | null>(null);
  const [err, setErr] = useState("");
  const [list, setList] = useState(() => !!focusId || beliefsPending());
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [goal, setGoal] = useState<{ at: [number, number, number]; dist: number; n: number } | null>(null);
  const [when, setWhen] = useState<number | null>(null); // replayed moment (ms); null = now
  const [playing, setPlaying] = useState(false);
  const [people, setPeople] = useState(false); // the People ring replaces the constellation (its own canvas)
  const ppl = usePeople(people && !paused);
  const fly = (at: [number, number, number], dist: number) => setGoal((g) => ({ at, dist, n: (g?.n ?? 0) + 1 }));

  useEffect(() => { // refetch when returning from List view or to the world: memories may have been added or deleted meanwhile
    if (paused || (list && data)) return;
    let live = true;
    fetch("/api/memories/map").then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Could not load memories (${r.status})`);
      if (live) { setData(j as MapData); setErr(""); }
    }).catch((e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [list, paused]); // eslint-disable-line react-hooks/exhaustive-deps -- data is only the "already loaded" guard

  const index = useMemo(() => new Map(data?.items.map((m, i) => [m.id, i]) ?? []), [data]);
  useEffect(() => { if (focusId) setList(true); }, [focusId]); // a newly opened memory shows its detail once; Constellation stays reachable
  useEffect(() => { setSel(null); setHover(null); setWhen(null); setPlaying(false); }, [data]); // positions are array indexes: a refetch reorders them
  useEffect(() => { // OPEN_MEMORY_EVENT (palette, CORE, a star click) arrives as focusId: select and fly to its star
    if (!focusId) return;
    const i = index.get(focusId);
    if (i !== undefined && data) { setSel(i); const m = data.items[i]; fly([m.x, m.y, m.z], 9); }
  }, [focusId, index, data]);
  useEffect(() => { // not gated on paused: this nav also opens MEMORY, and arrives before the world un-pauses
    const h = (e: Event) => { if ((e as CustomEvent<NavTarget>).detail?.beliefs) setList(true); };
    addEventListener(NAV_EVENT, h);
    return () => removeEventListener(NAV_EVENT, h);
  }, []);

  const span = useMemo(() => (data ? created(data.items) : null), [data]);
  const spanDays = span ? Math.max(1, Math.ceil((span.now - span.t0) / DAY)) : 1;
  useEffect(() => { // replay: step the moment forward from the first memory to now
    if (!playing || !span) return;
    const ticks = reduced ? REPLAY_TICKS_REDUCED : REPLAY_TICKS, step = (span.now - span.t0) / ticks;
    const t = setInterval(() => setWhen((w) => {
      const next = (w ?? span.t0) + step;
      if (next >= span.now) { setPlaying(false); return null; }
      return next;
    }), reduced ? REPLAY_MS_REDUCED : REPLAY_MS);
    return () => clearInterval(t);
  }, [playing, span, reduced]);
  const play = () => { if (!span) return; if (playing) { setPlaying(false); return; } setWhen(span.t0); setPlaying(true); };
  const whenLabel = when === null ? "Now · live" : new Date(when).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  const hits = useMemo(() => (data ? searchStars(data.items, query) : []), [data, query]);
  useEffect(() => { // ease toward the matches as the query settles
    if (!data || !hits.length) return;
    const t = setTimeout(() => {
      const pts = hits.map((i) => data.items[i]), c = centroid(pts);
      const spread = Math.max(...pts.map((p) => Math.hypot(p.x - c[0], p.y - c[1], p.z - c[2])));
      fly(c, Math.min(48, Math.max(9, spread * 2.4)));
    }, 350);
    return () => clearTimeout(t);
  }, [hits, data]);
  const hi = useMemo(() => {
    const s = new Set(hits);
    if (hover !== null) s.add(hover);
    if (sel !== null) s.add(sel);
    return s;
  }, [hits, hover, sel]);

  const open = (i: number) => {
    const m = data?.items[i];
    if (!m) return;
    setSel(i);
    setList(true);
    dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id: m.id } }));
  };
  const labelAt = hover ?? sel;
  const label = labelAt !== null ? data?.items[labelAt] : undefined;
  const kinds = useMemo(() => [...new Set(data?.items.map((m) => m.kind))].sort(), [data]);
  const onCreated = (s: RootState) => { glr.onCreated(s); s.raycaster.params.Points = { threshold: 0.45 }; };

  return (
    <div role="region" className="absolute inset-0 globe-in" aria-label="MEMORY: your memories as a constellation" style={{ background: BG }}>
      {!flat && later && people && <PeopleCanvas st={ppl} reduced={reduced} paused={paused} />}
      {!flat && later && !people && (
        <Canvas key={glr.key} onCreated={onCreated} frameloop={paused ? "never" : "always"} camera={{ position: [0, 6, 46], fov: 50, near: 0.1, far: 400 }} dpr={[1, q.dpr]} gl={{ antialias: false }}
          onPointerMissed={() => setSel(null)} style={{ cursor: hover !== null ? "pointer" : undefined }}>
          {quality === "auto" && <PerformanceMonitor onDecline={q.onDecline} />}
          <WarmCompile world="memory" />
          <color attach="background" args={[BG]} />
          <Stars radius={120} depth={60} count={reduced ? 800 : Math.min(3000, q.stars)} factor={2.2} fade speed={reduced ? 0 : 0.2} />
          <FarRings reduced={reduced} />
          {data && <Constellation data={data} at={when} hi={hi} searching={!!query.trim()} reduced={reduced} lite={q.bloomScale === 0} onHover={setHover} onPick={open} />}
          {label && (
            <Html position={[label.x, label.y, label.z]} style={{ pointerEvents: "none", transform: "translate(14px, -50%)" }} zIndexRange={[12, 0]}>
              <div className="memory-star-label"><b>{label.title}</b><span>{label.kind}{isLearned(label.source) ? " · learned by CORE" : ""}</span></div>
            </Html>
          )}
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={3} maxDistance={110} autoRotate={!reduced && hover === null} autoRotateSpeed={0.18} />
          <Fly goal={goal} reduced={reduced} />
          {q.bloomScale > 0 && (
            <EffectComposer multisampling={q.msaa}>
              <Bloom intensity={(reduced ? 0.3 : 0.5) * q.bloomScale} luminanceThreshold={0.6} luminanceSmoothing={0.35} mipmapBlur />
              <Vignette offset={0.3} darkness={0.75} />
              <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
              {q.msaa ? <></> : <SMAA />}
            </EffectComposer>
          )}
        </Canvas>
      )}

      <section className="glass hud-panel world-panel panel-in absolute inset-x-3 bottom-32 z-[14] flex max-h-[45dvh] flex-col gap-3 overflow-y-auto p-3 text-sm min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:right-3 min-[900px]:top-[4.5rem] min-[900px]:max-h-[calc(100dvh-11rem)] min-[900px]:w-[30rem]" aria-label="MEMORY controls">
        <div className="flex items-center justify-between gap-2">
          <h2 className="brand text-base">MEMORY <span className="muted num text-xs font-normal">{data ? `${data.items.length}${data.total > data.items.length ? ` of ${data.total}` : ""} stars` : ""}</span></h2>
          <div className="flex gap-1.5">
            {!flat && <button className="chip" aria-pressed={!list && !people} onClick={() => { setList(false); setPeople(false); }}>Constellation</button>}
            {!flat && <button className="chip" aria-pressed={list && !people} onClick={() => { setList(true); setPeople(false); }}>List view</button>}
            <button className="chip" aria-pressed={people} onClick={() => setPeople(!people)}>People</button>
          </div>
        </div>

        {!people && <MemoryHygiene onChanged={onChanged} />}
        {people ? <PeoplePanel st={ppl} /> : list || flat ? <MemoryPanel focusId={focusId} onChanged={onChanged} /> : <>
          <input className="field" type="search" placeholder="Find a memory · title, kind or tag" value={query} maxLength={200}
            onChange={(e) => setQuery(e.target.value)} aria-label="Search memories in the constellation" />
          {err && <p className="error" role="alert">{err}</p>}
          {!data && !err && <p className="muted" role="status">Charting your memories…</p>}
          {data && !data.items.length && <p className="muted">No memories yet. Open List view to capture your first one.</p>}
          {query.trim() && data && <div className="space-y-1" aria-live="polite">
            <div className="muted text-[10px] uppercase tracking-widest">{hits.length ? `${hits.length} match${hits.length > 1 ? "es" : ""}` : "Nothing matched"}</div>
            <ul className="space-y-0.5">{hits.slice(0, 12).map((i) => { const m = data.items[i]; return (
              <li key={m.id}><button className="chip w-full justify-between text-left" aria-pressed={sel === i}
                onClick={() => { setSel(i); fly([m.x, m.y, m.z], 9); }} onDoubleClick={() => open(i)}>
                <span className="truncate">{m.title}</span><span className="muted">{m.kind}</span></button></li>); })}</ul>
          </div>}
          {sel !== null && data?.items[sel] && <div className="card space-y-1">
            <div className="font-medium">{data.items[sel].title}</div>
            <p className="muted text-xs">{data.items[sel].kind} · {new Date(data.items[sel].created_at).toLocaleDateString([], { dateStyle: "medium" })}{isLearned(data.items[sel].source) ? " · learned by CORE" : ""}{data.items[sel].tags.length ? ` · #${data.items[sel].tags.slice(0, 4).join(" #")}` : ""}</p>
            <button className="btn" onClick={() => open(sel)}>Open memory</button>
          </div>}
          {span && data && data.items.length > 1 && <div role="group" aria-label="Memory timeline" className="flex items-center gap-3 text-xs">
            <button className="chip" onClick={play} aria-pressed={playing}>{playing ? "Pause" : "Replay"}</button>
            <span className="w-24 shrink-0 tabular-nums" aria-live={playing ? "off" : "polite"}>{whenLabel}</span>
            <input type="range" min={0} max={spanDays} step={1} value={when === null ? spanDays : Math.round((when - span.t0) / DAY)}
              aria-label="Day in your memory history" aria-valuetext={whenLabel} className="h-1 min-w-0 flex-1 accent-sky-300"
              onChange={(e) => { setPlaying(false); const d = Number(e.target.value); setWhen(d >= spanDays ? null : span.t0 + d * DAY); }} />
            <button className="chip" onClick={() => { setPlaying(false); setWhen(null); }} disabled={when === null}>Now</button>
          </div>}
          {kinds.length > 0 && <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" aria-label="Legend">
            {kinds.map((k) => <li key={k} className="muted flex items-center gap-1.5"><i aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9, background: kindColor(k), boxShadow: `0 0 6px ${kindColor(k)}` }} />{k}</li>)}
            <li className="muted flex items-center gap-1.5"><i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 9, border: "1px solid currentColor" }} />learned by CORE</li>
          </ul>}
          <p className="muted text-[11px]">Nearby stars are similar memories; threads are links, and the faint web joins similar memories (newer links glow brighter). Drag to orbit, scroll to zoom, click a star to open it.</p>
        </>}
      </section>

      <button className="chip world-back absolute bottom-28 right-3 z-[15] min-[900px]:bottom-24 min-[900px]:right-[32rem]" onClick={onClose}>← Back to galaxy</button>
    </div>
  );
}
