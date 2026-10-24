"use client";
import { WarmCompile } from "./WarmCompile";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping, SMAA } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useGlRecovery } from "./useGlRecovery";
import { FrameMark } from "./dev-timing";
import { loadImage } from "./texture-cache";
import { ZoomRig } from "./ZoomRig";
import Hologram from "./Hologram";
import { HOLO, useAlienEnv } from "./alien/env";
import { holoLine } from "@/lib/hologram-pure";
import { AgentsPanel, type Task } from "./AgentsPanels";
import AgentMission, { STATUS_DOT, api, usePoll } from "./AgentMission";
import TeamBuilder from "./TeamBuilder";
import IdeasPanel from "./IdeasPanel";
import RecipesPanel from "./RecipesPanel";
import GoalsPanel from "./GoalsPanel";
import { CHAIN_TITLE, type ChainView } from "@/lib/chains-pure";
import { beamPairs, chainActive } from "@/lib/mission-pure";
import type { QualityMode } from "@/lib/quality-pure";
import { useLeanQuality } from "./useLeanQuality";
import { smoothDamp } from "@/lib/smooth-damp-pure";
import { ORBIT_R, STATUS_LABEL, activityFeed, agentStatus, clamp, currentTask, orbitPos, statusGlow, statusVisual, streamFrac, type AgentStatus } from "@/lib/station-pure";
import { MaskText } from "./MaskText";

// AGENTS → a floating obsidian ring station (alien megastructure theme): each agent is a ship circling its docking lane,
// glowing by status, plotted live on a holographic tactical map behind the station.
// Data: /api/agents (roster + running counts incl. sub-tasks), /api/tasks (top-level tasks), /api/tasks/:id (live trace).
// Built-in materials only and every emissive/opacity value goes through clamp(), so Bloom never sees NaN/negative output.

type Agent = { slug: string; name: string; role: string; color: string; builtin: boolean; stats: { running: number } };

const HOME = 14.5;
const ago = (iso: number) => { const s = Math.max(0, (Date.now() - iso) / 1000); return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

/* ---------- scene ---------- */

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3K4zaF8Ip5JyEmwNLHr5iAw89pD/hf_";
const SKY = ["/textures/station-sky.webp", `${CDN}20261016_163030_6e995a4e-305a-4521-b084-41c641fe9555.png`] as const;
const DECK_Y = -0.62, DECK_R = 4.7; // the obsidian deck the ships hover over (their lanes are ORBIT_R 3 / 4.1)

/** Local copy first (`npm run textures`), then the CDN; null keeps the plain look. repeatX > 0 mirrors the map around a sphere/torus (no seam). */
function useTex([local, cdn]: readonly [string, string], repeatX = 0) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let dead = false, made: THREE.Texture | null = null;
    loadImage(local, cdn).then((img) => { // shared decoded image: reopening the world doesn't download or decode it again
      const t = new THREE.Texture(img); t.needsUpdate = true;
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      if (repeatX) { t.wrapS = THREE.MirroredRepeatWrapping; t.repeat.x = repeatX; }
      made = t;
      if (dead) t.dispose(); else setTex(t);
    }).catch(() => { /* offline */ });
    return () => { dead = true; made?.dispose(); };
  }, [local, cdn, repeatX]);
  return tex;
}

/** Soft round glow (halo sprites, dust, beam particles): one small canvas texture for the whole station. */
function useGlowTexture() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.25, "rgba(255,255,255,0.55)"); grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

/** The violet nebula on a huge inverted sphere, dimmed so the panels stay readable. */
function Sky() {
  const tex = useTex(SKY, 2);
  if (!tex) return null;
  return <mesh><sphereGeometry args={[200, 48, 32]} /><meshBasicMaterial map={tex} color="#3c3a58" side={THREE.BackSide} depthWrite={false} /></mesh>;
}

/** Slow drifting dust around the station. */
function Dust({ count, glow, reduced }: { count: number; glow: THREE.Texture; reduced: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const a = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
      const r = 2 + Math.random() * 12, th = Math.random() * Math.PI * 2;
      a[k * 3] = Math.cos(th) * r; a[k * 3 + 1] = (Math.random() - 0.5) * 6; a[k * 3 + 2] = Math.sin(th) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(a, 3));
    return g;
  }, [count]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dt) => { if (ref.current && !reduced) ref.current.rotation.y += Math.min(dt, 0.1) * 0.008; });
  return <points ref={ref} geometry={geo}><pointsMaterial map={glow} size={0.05} color="#d6e2ff" transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} /></points>;
}

/** Dark mirror for every hard surface (deck, keel, blade ring, hulls): standard material + the shared alien reflection map. */
function useObsidian(color = "#05060a", roughness = 0.2) {
  const env = useAlienEnv();
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, metalness: 0.92, roughness, flatShading: true, envMapIntensity: 1.2 }), [color, roughness]);
  useEffect(() => { mat.envMap = env; mat.needsUpdate = true; }, [mat, env]);
  useEffect(() => () => mat.dispose(), [mat]);
  return mat;
}

const CYAN: [number, number, number] = [0.45, 1.05, 1.4], VIOLET: [number, number, number] = [0.8, 0.7, 1.5]; // restrained: pearl-leaning, under the bloom knee
/** Glowing line on the deck: a full ring, or `arcs` dashed segments (ringGeometry thetaLength). */
function DeckLine({ r, w = 0.012, color, arcs = 0, opacity = 0.9 }: { r: number; w?: number; color: [number, number, number]; arcs?: number; opacity?: number }) {
  const segs = arcs ? Array.from({ length: arcs }, (_, k) => (k / arcs) * Math.PI * 2) : [0];
  const len = arcs ? (Math.PI * 2) / arcs * 0.62 : Math.PI * 2;
  return <>{segs.map((s) => (
    <mesh key={s} rotation-x={-Math.PI / 2}><ringGeometry args={[r - w, r + w, arcs ? 48 : 192, 1, s, len]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
  ))}</>;
}

/** The floating obsidian ring station (concept c2): a faceted deck with glowing concentric lanes, a lens core with a light
 *  column, a slow monolithic blade ring around the rim, and a crystalline keel underneath. */
function Hub({ reduced, lite }: { reduced: boolean; lite: boolean }) {
  const obsidian = useObsidian("#05060a", 0.34); // rougher deck: no hard softbox glint in the middle of it
  const blade = useRef<THREE.Group>(null), inner = useRef<THREE.Group>(null), core = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (reduced) return;
    if (blade.current) blade.current.rotation.y += dt * 0.05;
    if (inner.current) inner.current.rotation.y -= dt * 0.16;
    if (core.current) core.current.rotation.y += dt * 0.5;
  });
  return (
    <group>
      {/* deck + keel */}
      <mesh position-y={DECK_Y} material={obsidian}><cylinderGeometry args={[DECK_R, DECK_R - 0.25, 0.22, 72, 1]} /></mesh>
      <mesh position-y={DECK_Y - 0.11 - 0.95} rotation-x={Math.PI} material={obsidian}><coneGeometry args={[DECK_R - 0.3, 1.9, 9, 1]} /></mesh>
      <mesh position-y={DECK_Y - 0.11 - 2.2} rotation-x={Math.PI} material={obsidian}><coneGeometry args={[0.5, 1.4, 6, 1]} /></mesh>
      <group position-y={DECK_Y + 0.115}>
        <DeckLine r={DECK_R - 0.12} w={0.008} color={CYAN} />
        <DeckLine r={ORBIT_R[1]} w={0.014} color={VIOLET} />
        <DeckLine r={ORBIT_R[0]} w={0.014} color={CYAN} />
        <DeckLine r={1.55} w={0.01} color={CYAN} opacity={0.6} />
        {!lite && <group ref={inner}>
          <DeckLine r={ORBIT_R[1] + 0.22} w={0.02} color={CYAN} arcs={9} opacity={0.5} />
          <DeckLine r={ORBIT_R[0] - 0.22} w={0.02} color={VIOLET} arcs={6} opacity={0.55} />
          <DeckLine r={2.15} w={0.05} color={CYAN} arcs={24} opacity={0.35} />
        </group>}
        {/* radial spokes */}
        {!lite && Array.from({ length: 12 }, (_, k) => (
          <mesh key={k} rotation-x={-Math.PI / 2} rotation-z={(k / 12) * Math.PI * 2} position={[Math.cos((k / 12) * Math.PI * 2) * 2.95, 0, -Math.sin((k / 12) * Math.PI * 2) * 2.95]}>
            <planeGeometry args={[2.9, 0.012]} /><meshBasicMaterial color={CYAN} transparent opacity={0.22} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
        ))}
      </group>
      {/* lens core: a dark mirrored dome, a spinning halo and a light column up to the tactical map */}
      <mesh position-y={DECK_Y + 0.11} scale={[1, 0.42, 1]} material={obsidian}><sphereGeometry args={[1.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
      <group ref={core} position-y={DECK_Y + 0.3}>
        <mesh rotation-x={Math.PI / 2}><torusGeometry args={[1.12, 0.012, 6, 128]} /><meshBasicMaterial color={CYAN} toneMapped={false} /></mesh>
        <mesh rotation-x={Math.PI / 2 + 0.25}><torusGeometry args={[0.8, 0.008, 6, 96, Math.PI * 1.3]} /><meshBasicMaterial color={VIOLET} toneMapped={false} /></mesh>
      </group>
      <mesh position-y={DECK_Y + 0.62}><sphereGeometry args={[0.16, 16, 12]} /><meshBasicMaterial color={[1.6, 1.9, 2]} toneMapped={false} /></mesh>
      <mesh position-y={DECK_Y + 1.95}><cylinderGeometry args={[0.012, 0.035, 2.7, 8, 1, true]} /><meshBasicMaterial color={CYAN} transparent opacity={0.16} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
      {/* monolithic blade ring at the rim, faceted like the galaxy's singularity rings */}
      <group ref={blade} position-y={DECK_Y + 0.05}>
        <mesh rotation-x={Math.PI / 2} scale={[1, 1, 2.2]} material={obsidian}><torusGeometry args={[DECK_R + 0.32, 0.07, 4, 160]} /></mesh>
        <mesh rotation-x={Math.PI / 2} position-y={0.17}><torusGeometry args={[DECK_R + 0.32, 0.006, 4, 192]} /><meshBasicMaterial color={VIOLET} toneMapped={false} /></mesh>
      </group>
      <directionalLight position={[5, 6, 4]} intensity={1.4} color="#dbeafe" />
      <directionalLight position={[-6, -2, -5]} intensity={0.8} color="#a78bfa" />
      <pointLight position-y={0.6} intensity={2} decay={0} color="#7ae3ff" />
    </group>
  );
}

/* ---------- holographic tactical map (one quad, one procedural shader) ---------- */
const MAP_N = 16;
const MAP_W = 9.4, MAP_H = 4.1, MAP_SPAN = 5.2; // world radius that fills the radar
const MAP_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const MAP_FS = /* glsl */ `
uniform float uTime; uniform float uN; uniform vec4 uAg[${MAP_N}]; uniform vec3 uCol[${MAP_N}];
varying vec2 vUv;
${HOLO}
float h1(float x) { return fract(sin(x * 91.17) * 43758.5453); }
// AA line: never thinner than ~1 px on screen; a widened line dims by the same factor, so far-off lines fade rather than shimmer
float line(float d, float w) { float W = max(w, fwidth(d) * 1.2); return smoothstep(W, 0.0, abs(d)) * (w / W); }
void main() {
  const float AR = ${(MAP_W / MAP_H).toFixed(4)};
  vec2 q = vec2(vUv.x * AR, vUv.y);
  float ed = min(min(q.x, AR - q.x), min(q.y, 1.0 - q.y));
  vec3 cy = vec3(0.35, 0.9, 1.0);
  vec3 c = cy * 0.05; float a = 0.16;                                       // glass tint
  float frame = line(ed - 0.004, 0.0035) + 0.5 * line(ed - 0.02, 0.0015);
  c += mix(cy, holo(vUv.x * 0.6 + uTime * 0.02), 0.3) * frame * 1.1; a += frame;
  // radar
  vec2 p = q - vec2(AR * 0.5, 0.5); float R = 0.43, d = length(p), ang = atan(p.y, p.x);
  float rings = 0.0;
  for (int k = 1; k <= 4; k++) rings += line(d - R * float(k) * 0.25, 0.0018);
  rings += line(p.x, 0.0012) * step(d, R) + line(p.y, 0.0012) * step(d, R);
  float tk = ang / 6.2831853 * 72.0;
  float ticks = mix(step(0.92, fract(tk)), 0.08, smoothstep(0.25, 0.6, fwidth(tk))) * step(R, d) * step(d, R + 0.025); // 72 ticks merge to a soft band far off
  float sweepA = mod(uTime * 0.6, 6.2831853);
  float da = mod(sweepA - ang + 6.2831853, 6.2831853);
  float sweep = exp(-da * 2.2) * step(d, R);
  c += cy * (rings * 0.8 + ticks * 0.6 + sweep * 0.22); a += rings * 0.6 + ticks * 0.45 + sweep * 0.16;
  // lanes (the station's real orbits) as brighter arcs
  float lane = line(d - R * ${(ORBIT_R[0] / MAP_SPAN).toFixed(4)}, 0.003) + line(d - R * ${(ORBIT_R[1] / MAP_SPAN).toFixed(4)}, 0.003);
  c += mix(cy, holo(ang * 0.16 + uTime * 0.03), 0.4) * lane * 1.1; a += lane;
  // agents
  for (int i = 0; i < ${MAP_N}; i++) {
    if (float(i) >= uN) break;
    vec4 g = uAg[i]; if (g.w < 0.5) continue;
    vec2 at = vec2(g.x, -g.y) * (R / ${MAP_SPAN.toFixed(2)});
    float dd = length(p - at);
    float dot_ = smoothstep(0.012, 0.004, dd), halo = smoothstep(0.035, 0.0, dd) * 0.5;
    float pulse = g.z > 0.5 ? line(dd - 0.018 - 0.02 * fract(uTime * 0.9 + float(i) * 0.13), 0.002) : 0.0;
    c += uCol[i] * (dot_ * 1.6 + halo * 0.8 + pulse * 1.1); a += dot_ + halo + pulse;
  }
  float core = smoothstep(0.03, 0.0, d); c += vec3(0.9, 1.15, 1.3) * core; a += core;
  // side readouts: rows of flickering glyph bars
  float side = step(0.07, q.x) * step(q.x, 0.62) + step(AR - 0.62, q.x) * step(q.x, AR - 0.07);
  float row = floor(q.y * 46.0), fy = fract(q.y * 46.0);
  float col = floor(q.x * 70.0);
  float len = 0.2 + 0.8 * h1(row + floor(q.x / (AR * 0.5)) * 17.0);
  float xin = (q.x < AR * 0.5 ? (q.x - 0.07) / 0.55 : (q.x - AR + 0.62) / 0.55);
  float bar = step(0.3, fy) * step(fy, 0.7) * step(xin, len) * step(0.25, h1(col * 3.1 + row)) * step(0.06, q.y) * step(q.y, 0.94);
  bar = mix(bar, 0.12 * step(0.06, q.y) * step(q.y, 0.94), smoothstep(0.3, 0.7, fwidth(q.y * 46.0))); // glyph rows merge to a faint wash far off
  float tb = uTime * 0.5, fb = smoothstep(0.0, 1.0, fract(tb));                            // readouts cross-fade (no hard flicker)
  bar *= 0.6 + 0.4 * mix(step(0.5, h1(row + floor(tb))), step(0.5, h1(row + floor(tb) + 1.0)), fb);
  vec3 barC = mix(cy, vec3(0.78, 0.72, 1.0), step(0.86, h1(row * 3.7)));
  c += barC * bar * side * 0.55; a += bar * side * 0.4;
  float sl = vUv.y * 900.0;
  c *= 1.0 - 0.12 * (0.5 - 0.5 * sin(sl)) * (1.0 - smoothstep(0.08, 0.25, fwidth(sl)));       // scanlines only where they resolve
  gl_FragColor = vec4(clamp(c * 0.8, 0.0, 1.6), clamp(a, 0.0, 1.0));
}`;
const STATUS_CODE: Record<AgentStatus, number> = { idle: 0, working: 1, waiting: 2, failed: 3 };

/** Big translucent screen behind the station: radar of the real lanes with every agent plotted live (concept c2). */
function TacticalMap({ list, status, groups, reduced }: { list: Agent[]; status: Record<string, AgentStatus>; groups: Map<string, THREE.Group>; reduced: boolean }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: MAP_VS, fragmentShader: MAP_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uN: { value: 0 }, uAg: { value: Array.from({ length: MAP_N }, () => new THREE.Vector4()) }, uCol: { value: Array.from({ length: MAP_N }, () => new THREE.Color()) } },
  }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => { // colours change with data, not per frame (Color.set parses strings)
    const col = mat.uniforms.uCol.value as THREE.Color[];
    list.slice(0, MAP_N).forEach((a, k) => col[k].set(status[a.slug] === "waiting" ? "#fbbf24" : status[a.slug] === "failed" ? "#ef4444" : a.color));
    mat.uniforms.uN.value = Math.min(MAP_N, list.length);
  }, [mat, list, status]);
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = reduced ? 2 : clock.elapsedTime;
    const ag = mat.uniforms.uAg.value as THREE.Vector4[];
    for (let k = 0; k < MAP_N; k++) {
      const a = list[k], g = a ? groups.get(a.slug) : undefined;
      if (g) ag[k].set(g.position.x, g.position.z, STATUS_CODE[status[a.slug]] === 1 ? 1 : 0, 1); else ag[k].w = 0;
    }
  });
  return <mesh position={[0, 2.35, -6.6]} rotation-x={-0.08} material={mat}><planeGeometry args={[MAP_W, MAP_H]} /></mesh>;
}

type Pos = () => THREE.Object3D | null | undefined;
/** Data stream: hub → agent (working) or, with `source`, agent → agent (team hand-off). A faint line plus a few particles riding it. */
function Beam({ target, source, color, glow, count, reduced, strength = 1 }: { target: Pos; source?: Pos; color: string; glow: THREE.Texture; count: number; reduced: boolean; strength?: number }) {
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    l.frustumCulled = false;
    return l;
  }, [color, strength]);
  const pts = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3)); return g; }, [count]);
  useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }, [line]);
  useEffect(() => () => pts.dispose(), [pts]);
  const ptsMat = useRef<THREE.PointsMaterial>(null), born = useRef(0); // a new beam (status poll) fades in instead of popping
  useFrame(({ clock }, dt) => {
    born.current = reduced ? 1 : Math.min(1, born.current + Math.min(dt, 0.1) * 1.5);
    (line.material as THREE.LineBasicMaterial).opacity = clamp(0.2 * strength, 0, 0.5) * born.current;
    if (ptsMat.current) ptsMat.current.opacity = clamp(0.6 * strength, 0, 0.8) * born.current;
    const p = target()?.position;
    if (!p) return;
    const q = source ? source()?.position : null;
    if (source && !q) return;
    const sx = q ? q.x : p.x * 0.3, sy = q ? q.y : p.y * 0.3, sz = q ? q.z : p.z * 0.3; // hub beams start just outside the core
    const la = line.geometry.attributes.position as THREE.BufferAttribute, a = la.array as Float32Array;
    a[0] = sx; a[1] = sy; a[2] = sz; a[3] = p.x; a[4] = p.y; a[5] = p.z;
    la.needsUpdate = true;
    const v = statusVisual("working", clock.elapsedTime, reduced);
    const pa = pts.attributes.position as THREE.BufferAttribute, b = pa.array as Float32Array;
    for (let k = 0; k < count; k++) {
      const f = (0.65 / 0.7) * streamFrac(k, count, clock.elapsedTime, v.beamSpeed);
      b[k * 3] = sx + (p.x - sx) * f; b[k * 3 + 1] = sy + (p.y - sy) * f; b[k * 3 + 2] = sz + (p.z - sz) * f;
    }
    pa.needsUpdate = true;
  });
  return (
    <>
      <primitive object={line} />
      <points geometry={pts} frustumCulled={false}><pointsMaterial ref={ptsMat} map={glow} size={0.11 * clamp(strength, 0.5, 1.6)} color={color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} /></points>
    </>
  );
}

/** Ship parts shared by every agent (one upload each): a flat wedge hull, swept wings, twin nacelles. Tip points +z. */
function useShipParts() {
  const parts = useMemo(() => {
    const hull = new THREE.ConeGeometry(0.19, 0.95, 6, 1); hull.rotateX(Math.PI / 2); hull.scale(1, 0.42, 1);
    const wing = new THREE.BoxGeometry(0.8, 0.02, 0.24); wing.translate(0, -0.015, -0.15);
    const nacelle = new THREE.CylinderGeometry(0.05, 0.06, 0.38, 8); nacelle.rotateX(Math.PI / 2);
    const strip = new THREE.BoxGeometry(0.026, 0.016, 0.52); strip.translate(0, 0.045, 0.03);
    return { hull, wing, nacelle, strip };
  }, []);
  useEffect(() => () => Object.values(parts).forEach((g) => g.dispose()), [parts]);
  return parts;
}
type ShipParts = ReturnType<typeof useShipParts>;

function Module({ agent, i, n, status, selected, reduced, lite, parts, metal, glow, groups, task, onPick, onHover }: {
  agent: Agent; task?: string; i: number; n: number; status: AgentStatus; selected: boolean; reduced: boolean; lite: boolean;
  parts: ShipParts; metal: THREE.Material; glow: THREE.Texture; groups: Map<string, THREE.Group>;
  onPick: (slug: string) => void; onHover: (slug: string | null, x: number, y: number) => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const slug = agent.slug;
  const setRef = useCallback((g: THREE.Group | null) => { ref.current = g; if (g) groups.set(slug, g); else groups.delete(slug); }, [groups, slug]);
  const toMe = useCallback(() => ref.current, []);
  const ship = useRef<THREE.Group>(null);
  const pad = useRef<THREE.Group>(null);
  const tractor = useRef<THREE.Mesh>(null);
  const body = useObsidian("#3a4152", 0.22); // own material per ship: its emissive carries the status
  const halo = useRef<THREE.SpriteMaterial>(null);
  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  const shown = useRef<{ c: string; m: unknown }>({ c: "", m: null }); // Color.set() parses strings: only call it on change (or a new material)
  const sel = useRef<THREE.Group>(null), selA = useRef<THREE.MeshBasicMaterial>(null), selB = useRef<THREE.MeshBasicMaterial>(null), pick = useRef(0);
  useFrame(({ clock }, dt) => {
    pick.current = reduced ? (selected ? 1 : 0) : THREE.MathUtils.damp(pick.current, selected ? 1 : 0, 10, Math.min(dt, 0.1));
    if (sel.current) { sel.current.visible = pick.current > 0.005; sel.current.scale.setScalar(0.9 + 0.1 * pick.current); }
    if (selA.current) selA.current.opacity = pick.current;
    if (selB.current) selB.current.opacity = pick.current * 0.8;
    const t = reduced ? 0 : clock.elapsedTime;
    const p = ref.current?.position;
    if (p) {
      orbitPos(i, n, t, p);
      const a = Math.atan2(p.z, p.x), w = i % 2 ? -1 : 1; // same lane direction as orbitPos: inner ring +, outer ring −
      if (ship.current) { ship.current.rotation.y = Math.atan2(-Math.sin(a) * w, Math.cos(a) * w); ship.current.rotation.z = w * 0.22; }
      if (pad.current) pad.current.position.set(p.x, DECK_Y + 0.12, p.z);
      if (tractor.current) { const h = Math.max(0.01, p.y - DECK_Y - 0.12); tractor.current.scale.y = h; tractor.current.position.y = h / 2; }
    }
    const g = statusGlow(status, agent.color, clock.elapsedTime, reduced);
    const v = statusVisual(status, clock.elapsedTime, reduced);
    if (g.color !== shown.current.c || halo.current !== shown.current.m) { shown.current = { c: g.color, m: halo.current }; body.emissive.set(g.color); halo.current?.color.set(g.color); }
    body.emissiveIntensity = clamp(g.intensity * 0.6, 0, 2);
    if (ship.current) ship.current.scale.setScalar(v.scale);
    if (halo.current) halo.current.opacity = clamp(v.halo * 1.6, 0, 1);
    if (beacon.current) beacon.current.opacity = v.beacon;
  });
  return (
    <>
      {/* docking pad on the deck under the ship, with a faint tractor beam up to it */}
      <group ref={pad}>
        <mesh rotation-x={-Math.PI / 2}><ringGeometry args={[0.3, 0.33, 40]} /><meshBasicMaterial color={agent.color} transparent opacity={0.8} toneMapped={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
        {!lite && <mesh ref={tractor}><cylinderGeometry args={[0.008, 0.05, 1, 10, 1, true]} /><meshBasicMaterial color={agent.color} transparent opacity={0.09} toneMapped={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>}
      </group>
      {status === "working" && <Beam target={toMe} color={agent.color} glow={glow} count={lite ? 4 : 8} reduced={reduced} />}
      <group ref={setRef}>
        <group ref={ship}
          onClick={(e) => { e.stopPropagation(); if (e.delta <= 5) onPick(agent.slug); }}
          onPointerMove={(e) => { e.stopPropagation(); onHover(agent.slug, e.nativeEvent.clientX, e.nativeEvent.clientY); }}
          onPointerOut={(e) => onHover(null, e.nativeEvent.clientX, e.nativeEvent.clientY)}>
          <mesh geometry={parts.hull} material={body} />
          <mesh geometry={parts.wing} material={metal} />
          {[-1, 1].map((s) => <mesh key={s} geometry={parts.nacelle} material={metal} position={[s * 0.22, -0.008, -0.25]} />)}
          <mesh geometry={parts.strip}><meshBasicMaterial color={agent.color} toneMapped={false} /></mesh>
          {/* engine glow: the status halo, sat behind the nacelles */}
          <sprite position-z={-0.5} scale={[1, 0.55, 1]}><spriteMaterial ref={halo} map={glow} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} /></sprite>
        </group>
        {status === "waiting" && <mesh position-y={0.42}><octahedronGeometry args={[0.06, 0]} /><meshBasicMaterial ref={beacon} color="#fbbf24" transparent toneMapped={false} /></mesh>}
        <group ref={sel} visible={false}>{/* selection: fades in/out with the eased `pick` below */}
          <mesh rotation-x={Math.PI / 2}><torusGeometry args={[0.75, 0.008, 4, 4]} /><meshBasicMaterial ref={selA} color={[1.1, 1.35, 1.5]} transparent opacity={0} toneMapped={false} depthWrite={false} /></mesh>
          <mesh rotation-x={Math.PI / 2} rotation-z={Math.PI / 4}><torusGeometry args={[0.88, 0.004, 4, 64]} /><meshBasicMaterial ref={selB} color={VIOLET} transparent opacity={0} toneMapped={false} depthWrite={false} /></mesh>
        </group>
        {task && <Hologram text={task} position={[0, 0.6, 0]} size={0.14} color={agent.color} reduced={reduced} />}
      </group>
    </>
  );
}

/** One place for the shared textures/geometry, so every ship reuses one upload. */
function Station({ list, status, selected, reduced, lite, dust, handoffs, running, onPick, onHover }: {
  list: Agent[]; status: Record<string, AgentStatus>; running: Record<string, string>; selected: string | null; reduced: boolean; lite: boolean; dust: number; handoffs: [string, string][];
  onPick: (slug: string) => void; onHover: (slug: string | null, x: number, y: number) => void;
}) {
  const glow = useGlowTexture(), parts = useShipParts(), metal = useObsidian("#14161d", 0.28);
  const groups = useMemo(() => new Map<string, THREE.Group>(), []);
  const color = (slug: string) => list.find((a) => a.slug === slug)?.color ?? "#c4b5fd";
  return (
    <>
      <Sky />
      <Dust count={dust} glow={glow} reduced={reduced} />
      <Hub reduced={reduced} lite={lite} />
      <TacticalMap list={list} status={status} groups={groups} reduced={reduced} />
      {list.map((a, i) => <Module key={a.slug} agent={a} i={i} n={list.length} status={status[a.slug]} selected={a.slug === selected} reduced={reduced} lite={lite} parts={parts} metal={metal} glow={glow} groups={groups} task={running[a.slug]} onPick={onPick} onHover={onHover} />)}
      {/* team hand-off: previous step's drone → current step's drone */}
      {handoffs.map(([from, to]) => <Beam key={`${from}>${to}`} source={() => groups.get(from)} target={() => groups.get(to)} color={color(to)} glow={glow} count={lite ? 5 : 10} reduced={reduced} strength={1.4} />)}
    </>
  );
}

/** Follows the selected module: the orbit target tracks it (camera keeps its offset), with a one-time ease in on selection. */
function Follow({ index, n, reduced }: { index: number; n: number; reduced: boolean }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ({ target: THREE.Vector3; minDistance: number; maxDistance: number } & THREE.EventDispatcher<{ start: object }>) | null;
  const goal = useRef<number | null>(null), vel = useMemo(() => ({ v: 0 }), []);
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), d: new THREE.Vector3() }), []);
  useEffect(() => {
    goal.current = index >= 0 ? 5 : HOME;
    const stop = () => { goal.current = null; vel.v = 0; };
    controls?.addEventListener("start", stop);
    return () => controls?.removeEventListener("start", stop);
  }, [index, controls, vel]);
  useFrame(({ clock }, dt) => {
    if (!controls) return;
    const p = index >= 0 ? orbitPos(index, n, reduced ? 0 : clock.elapsedTime, tmp.p) : tmp.p.set(0, 0, 0);
    const before = tmp.d.copy(controls.target);
    controls.target.lerp(p, reduced ? 1 : 1 - Math.exp(-6 * dt));
    camera.position.add(before.sub(controls.target).negate()); // move with the target
    if (goal.current === null) return;
    const off = tmp.d.copy(camera.position).sub(controls.target), d = off.length();
    if (!(d > 0)) return;
    const next = reduced ? goal.current : smoothDamp(d, goal.current, vel, 0.45, Math.min(dt, 0.1)); // spring: eases in and out, no jerk
    camera.position.copy(controls.target).addScaledVector(off, next / d);
    if (Math.abs(next - goal.current) < 0.01 * goal.current) { goal.current = null; vel.v = 0; }
  });
  return null;
}

/** Keeps the station clear of the right-hand panel on wide screens (same as DevWorld). */
function Rig() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    if (size.width >= 900) camera.setViewOffset(size.width, size.height, 240, 0, size.width, size.height);
    else camera.clearViewOffset();
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

/* ---------- data + UI ---------- */

type Props = { paused?: boolean /* kept mounted but hidden: polls stop via WorldPaused in usePoll */; flat?: boolean; onClose: () => void; reduced: boolean; quality?: QualityMode; onOpenTask?: (id: string) => void; focusGoal?: string | null; radarUrl?: string | null; onRadarDone?: () => void };

export default function AgentsStation({ flat, onClose, reduced, quality = "auto", onOpenTask, focusGoal, radarUrl, onRadarDone, paused = false }: Props) {
  const glr = useGlRecovery();
  const [visible, setVisible] = useState(true);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [tab, setTab] = useState<"agents" | "teams" | "goals" | "ideas" | "recipes">("agents");
  useEffect(() => { if (focusGoal) setTab("goals"); }, [focusGoal]);
  useEffect(() => { if (radarUrl) setTab("ideas"); }, [radarUrl]);
  const [chains, setChains] = useState<ChainView[] | null>(null);
  const [chainErr, setChainErr] = useState("");
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const last = useRef<string | null>(null); // agent whose detail was open: its row gets focus back
  useEffect(() => {
    if (selected) { last.current = selected; return; }
    if (last.current) rows.current.get(last.current)?.focus();
  }, [selected]);
  const [hover, setHover] = useState<{ id: string | null; x: number; y: number }>({ id: null, x: 0, y: 0 });

  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const loadAgents = useCallback(() => { api<{ agents: Agent[] }>("/api/agents").then((r) => { setAgents(r.agents); setErr(""); }).catch((e) => setErr(e.message)); }, []);
  const loadTasks = useCallback(() => { api<{ tasks: Task[] }>("/api/tasks").then((r) => { setTasks(r.tasks); setErr(""); }).catch((e) => setErr(e.message)); }, []);
  usePoll(loadAgents, 10_000, visible);
  usePoll(loadTasks, 3_000, visible);
  // Chains only advance when GET /api/chains runs: 4 s while one is live (or the Teams tab is open), else a slow check for new ones.
  const loadChains = useCallback(() => { api<{ chains: ChainView[] }>("/api/chains").then((r) => { setChains(r.chains); setChainErr(""); }).catch((e) => setChainErr(e.message)); }, []);
  usePoll(loadChains, chainActive(chains ?? []) || tab === "teams" ? 4_000 : 30_000, visible);
  const handoffs = useMemo(() => beamPairs(chains ?? []), [chains]);

  const onHover = useCallback((id: string | null, x: number, y: number) => {
    setHover((h) => (h.id === id && Math.abs(h.x - x) < 2 && Math.abs(h.y - y) < 2 ? h : { id, x, y }));
    document.body.style.cursor = id ? "pointer" : "";
  }, []);
  useEffect(() => () => { document.body.style.cursor = ""; }, [paused]); // leaving mid-hover must not keep the hand cursor

  const list = useMemo(() => agents ?? [], [agents]);
  // A team's parent row (agent nova, "running" for the whole chain) is bookkeeping, not Nova's own work.
  const status = useMemo(() => { const own = tasks.filter((t) => !t.title.startsWith(CHAIN_TITLE)); return Object.fromEntries(list.map((a) => [a.slug, agentStatus(own, a.slug, a.stats.running)])) as Record<string, AgentStatus>; }, [list, tasks]);
  const names = useMemo(() => Object.fromEntries(list.map((a) => [a.slug, a.name])), [list]);
  // Hologram over each working drone: its running task's name (at most 4, so the station stays cheap and readable).
  const running = useMemo(() => {
    const own = tasks.filter((t) => !t.title.startsWith(CHAIN_TITLE));
    return Object.fromEntries(list.filter((a) => status[a.slug] === "working").slice(0, 4)
      .flatMap((a) => { const t = currentTask(own, a.slug); return t && (t.status === "running" || t.status === "queued") ? [[a.slug, holoLine(t.title, 36)]] : []; }));
  }, [list, tasks, status]);
  const feed = useMemo(() => activityFeed(tasks, 10), [tasks]);
  const agent = list.find((a) => a.slug === selected) ?? null;
  const hovered = list.find((a) => a.slug === hover.id);
  const q = useLeanQuality(quality);

  return (
    <div className="absolute inset-0 globe-in">
      {!flat && <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={visible && !paused ? "always" : "never"} camera={{ position: [0, HOME * 0.45, HOME], fov: 42 }}
        dpr={[1, q.dpr]} gl={{ antialias: false, powerPreference: "high-performance" }} onPointerMissed={() => setSelected(null)}>
        <WarmCompile world="agents" />
        {quality === "auto" && <PerformanceMonitor onDecline={q.onDecline} />}
        <color attach="background" args={["#020308"]} />
        <Stars radius={70} depth={40} count={reduced ? Math.min(1500, q.stars) : q.stars} factor={2.4} fade speed={reduced ? 0 : 0.35} />
        <ambientLight intensity={0.35} />
        <Station list={list} status={status} selected={selected} reduced={reduced} lite={q.bloomScale === 0} dust={q.bloomScale === 0 ? 80 : q.bloomScale < 0.9 ? 180 : 320} handoffs={handoffs} running={running} onPick={setSelected} onHover={onHover} />
        <OrbitControls makeDefault enablePan={false} minDistance={2} maxDistance={HOME * 2.5} enableDamping dampingFactor={0.06} rotateSpeed={0.45} zoomSpeed={0.6} />
        <Follow index={list.findIndex((a) => a.slug === selected)} n={list.length} reduced={reduced} />
        <Rig />
        {!paused && <ZoomRig home={HOME * Math.hypot(1, 0.45)} reduced={reduced} />}
        {q.bloomScale > 0 && (
          <EffectComposer multisampling={q.msaa}>
            <Bloom intensity={(reduced ? 0.25 : 0.42) * q.bloomScale} luminanceThreshold={0.9} luminanceSmoothing={0.3} mipmapBlur />
            <Vignette offset={0.25} darkness={0.75} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            {q.msaa ? <></> : <SMAA />}
          </EffectComposer>
        )}
        {process.env.NODE_ENV === "development" && <FrameMark name="agents" />}
      </Canvas>}

      {hovered && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="globe-tip" style={{ transform: `translate(${hover.x + 14}px, ${hover.y + 12}px)` }}>
            {hovered.name} · {currentTask(tasks, hovered.slug)?.title.slice(0, 60) ?? STATUS_LABEL[status[hovered.slug]]}
          </span>
        </div>
      )}

      <section className="glass hud-panel world-panel panel-in absolute z-[14] inset-x-3 bottom-32 max-h-[40dvh] overflow-y-auto p-3 min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:right-3 min-[900px]:top-[4.5rem] min-[900px]:w-[30rem] min-[900px]:max-h-[calc(100dvh-11rem)]"
        aria-label="Agents station">
        {!agents ? (
          err ? <><p className="error">{err}</p><button className="chip mt-2" onClick={loadAgents}>Retry</button></> : <p className="muted">Docking…</p>
        ) : agent ? (
          <AgentMission key={agent.slug} agent={agent} status={status[agent.slug]} visible={visible} onClose={() => setSelected(null)} onChanged={loadTasks} onOpenTask={onOpenTask} />
        ) : manage ? (
          <><button className="chip mb-3" onClick={() => { setManage(false); loadAgents(); }}>← Station</button><AgentsPanel onOpenTask={(id) => onOpenTask?.(id)} /></>
        ) : (
          <>
            <div className="hud-title"><MaskText text="AGENTS STATION" /></div>
            <p className="muted text-xs">{list.length} agents · {list.filter((a) => status[a.slug] === "working").length} working · {list.filter((a) => status[a.slug] === "waiting").length} need approval{handoffs.length ? ` · ${handoffs.length} team hand-off${handoffs.length > 1 ? "s" : ""}` : ""}</p>
            <div className="mt-2 flex gap-1.5" role="tablist" aria-label="Station views">
              {(["agents", "teams", "goals", "ideas", "recipes"] as const).map((t) => (
                <button key={t} id={`st-tab-${t}`} role="tab" aria-selected={tab === t} aria-controls={`st-panel-${t}`} className="chip" style={tab === t ? { borderColor: "var(--cyan)" } : undefined} onClick={() => setTab(t)}>
                  {t === "agents" ? "🛰 Agents" : t === "teams" ? "👥 Teams" : t === "goals" ? "🎯 Goals" : t === "ideas" ? "💡 Ideas" : "📋 Recipes"}
                </button>
              ))}
            </div>
            {tab === "recipes" ? (
              <div id="st-panel-recipes" role="tabpanel" aria-labelledby="st-tab-recipes" className="mt-3">
                <RecipesPanel onOpenTask={onOpenTask} />
              </div>
            ) : tab === "ideas" ? (
              <div id="st-panel-ideas" role="tabpanel" aria-labelledby="st-tab-ideas" className="mt-3">
                <IdeasPanel initialUrl={radarUrl} onConsumed={onRadarDone} />
              </div>
            ) : tab === "goals" ? (
              <div id="st-panel-goals" role="tabpanel" aria-labelledby="st-tab-goals" className="mt-3">
                <GoalsPanel agents={list} visible={visible} onOpenTask={onOpenTask} focusId={focusGoal} />
              </div>
            ) : tab === "teams" ? (
              <div id="st-panel-teams" role="tabpanel" aria-labelledby="st-tab-teams" className="mt-3">
                <TeamBuilder agents={list} chains={chains} error={chainErr} onChanged={loadChains} onOpenTask={onOpenTask} />
              </div>
            ) : <div id="st-panel-agents" role="tabpanel" aria-labelledby="st-tab-agents">
            <ul className="mt-3 space-y-1">
              {list.map((a) => (
                <li key={a.slug}>
                  <button ref={(el) => { if (el) rows.current.set(a.slug, el); else rows.current.delete(a.slug); }} className="hud-row" style={{ ["--accent" as string]: STATUS_DOT[status[a.slug]] }} onClick={() => setSelected(a.slug)}
                    aria-label={`${a.name}, ${STATUS_LABEL[status[a.slug]]}`}>
                    <span className="truncate" style={{ color: a.color }}>{a.name}</span><span className="muted truncate text-xs">{STATUS_LABEL[status[a.slug]]}</span><span className="num" aria-hidden>●</span>
                  </button>
                </li>
              ))}
            </ul>
            <button className="chip mt-3" onClick={() => setManage(true)}>Manage agents & proposals</button>
            </div>}
          </>
        )}
        {err && agents && <p className="error mt-2" role="alert">{err}</p>}
      </section>

      <div role="log" aria-label="Agent activity" aria-relevant="additions" className="glass agents-log absolute z-[14] inset-x-3 bottom-[6.25rem] flex gap-4 overflow-x-auto whitespace-nowrap rounded-full px-4 py-1.5 text-xs min-[900px]:right-[32rem]">
        <span className="hud-title shrink-0 text-[0.7rem]">ACTIVITY</span>
        {feed.map((e) => (
          <span key={e.key} className="shrink-0">
            <b>{names[e.agent] ?? e.agent}</b> <span className="muted">{e.text.length > 70 ? `${e.text.slice(0, 70)}…”` : e.text}</span> <span className="muted" aria-hidden>· {ago(e.at)}</span>
          </span>
        ))}
        {!feed.length && <span className="muted">No agent activity yet. Give an agent a job.</span>}
      </div>

      <button className="chip world-back absolute z-[15] left-3 top-[4.5rem] min-[900px]:left-auto min-[900px]:top-auto min-[900px]:bottom-[8.5rem] min-[900px]:right-[32rem]" onClick={onClose}>← Back to galaxy</button>
    </div>
  );
}

