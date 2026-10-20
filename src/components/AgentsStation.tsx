"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useGlRecovery } from "./useGlRecovery";
import { FrameMark } from "./dev-timing";
import { loadImage } from "./texture-cache";
import { ZoomRig } from "./ZoomRig";
import { AgentsPanel, type Task } from "./AgentsPanels";
import AgentMission, { STATUS_DOT, api, usePoll } from "./AgentMission";
import TeamBuilder from "./TeamBuilder";
import IdeasPanel from "./IdeasPanel";
import RecipesPanel from "./RecipesPanel";
import GoalsPanel from "./GoalsPanel";
import { CHAIN_TITLE, type ChainView } from "@/lib/chains-pure";
import { beamPairs, chainActive } from "@/lib/mission-pure";
import { QUALITY, type QualityMode } from "@/lib/quality-pure";
import { ORBIT_R, STATUS_LABEL, activityFeed, agentStatus, clamp, currentTask, orbitPos, statusGlow, statusVisual, streamFrac, type AgentStatus } from "@/lib/station-pure";

// AGENTS → a space station: each agent is a drone module orbiting the hub, glowing by status.
// Data: /api/agents (roster + running counts incl. sub-tasks), /api/tasks (top-level tasks), /api/tasks/:id (live trace).
// Built-in materials only and every emissive/opacity value goes through clamp(), so Bloom never sees NaN/negative output.

type Agent = { slug: string; name: string; role: string; color: string; builtin: boolean; stats: { running: number } };

const HOME = 11;
const ago = (iso: number) => { const s = Math.max(0, (Date.now() - iso) / 1000); return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

/* ---------- scene ---------- */

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3K4zaF8Ip5JyEmwNLHr5iAw89pD/hf_";
const HULL = ["/textures/station-hull.webp", `${CDN}20261016_163030_8d81849e-003d-43e6-a8ad-9cc2449bbf46.png`] as const;
const SKY = ["/textures/station-sky.webp", `${CDN}20261016_163030_6e995a4e-305a-4521-b084-41c641fe9555.png`] as const;
const CORE = ["/textures/agent-core.webp", `${CDN}20261016_163031_a88c09d7-3df1-44d1-b5eb-8281fbb14a3a.png`] as const;

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
  return <mesh><sphereGeometry args={[200, 48, 32]} /><meshBasicMaterial map={tex} color="#77729a" side={THREE.BackSide} depthWrite={false} /></mesh>;
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
  useFrame((_, dt) => { if (ref.current && !reduced) ref.current.rotation.y += dt * 0.012; });
  return <points ref={ref} geometry={geo}><pointsMaterial map={glow} size={0.06} color="#c4b5fd" transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} /></points>;
}

function Hub({ reduced, lite, hull }: { reduced: boolean; lite: boolean; hull: THREE.Texture | null }) {
  const ring = useRef<THREE.Group>(null);
  const ringTex = useMemo(() => { if (!hull) return null; const c = hull.clone(); c.repeat.set(8, 1); c.needsUpdate = true; return c; }, [hull]);
  useEffect(() => () => ringTex?.dispose(), [ringTex]);
  useFrame((_, dt) => { if (ring.current && !reduced) ring.current.rotation.y += dt * 0.12; });
  return (
    <group>
      {/* core module: hull panels, its cyan/violet light strips glow through the emissive map */}
      <mesh>
        <sphereGeometry args={[0.8, 64, 48]} />
        <meshStandardMaterial key={hull ? "map" : "plain"} map={hull} emissiveMap={hull} color={hull ? "#ffffff" : "#334155"} emissive={hull ? "#b8a4ff" : "#1e1b4b"} emissiveIntensity={hull ? 0.55 : 0.4} metalness={0.55} roughness={0.4} />
      </mesh>
      {!lite && <mesh rotation-x={Math.PI / 2}><torusGeometry args={[0.805, 0.012, 8, 96]} /><meshBasicMaterial color={[0.45, 1.5, 1.7]} toneMapped={false} /></mesh>}
      {[1, -1].map((s) => (
        <group key={s} position-y={s * 0.95}>
          <mesh><cylinderGeometry args={[0.05, 0.12, 0.35, 12]} /><meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} /></mesh>
          <mesh position-y={s * 0.22}><sphereGeometry args={[0.045, 12, 12]} /><meshBasicMaterial color={[1.4, 1.0, 1.9]} toneMapped={false} /></mesh>
        </group>
      ))}
      {/* habitat ring: hull-textured torus with light strips, joined to the core by four spokes */}
      <group rotation-z={0.12}><group ref={ring}>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[1.6, 0.11, 20, 128]} />
          <meshStandardMaterial key={ringTex ? "map" : "plain"} map={ringTex} emissiveMap={ringTex} color={ringTex ? "#ffffff" : "#94a3b8"} emissive={ringTex ? "#7dd3fc" : "#000000"} emissiveIntensity={ringTex ? 0.45 : 0} metalness={0.7} roughness={0.35} />
        </mesh>
        {!lite && <mesh rotation-x={Math.PI / 2}><torusGeometry args={[1.47, 0.008, 6, 160]} /><meshBasicMaterial color={[0.4, 1.3, 1.6]} toneMapped={false} /></mesh>}
        {!lite && <mesh rotation-x={Math.PI / 2}><torusGeometry args={[1.73, 0.008, 6, 160]} /><meshBasicMaterial color={[1.1, 0.75, 1.8]} toneMapped={false} /></mesh>}
        {[0, 1, 2, 3].map((k) => (
          <group key={k} rotation-y={(k * Math.PI) / 2}>
            <mesh position={[1.17, 0, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.035, 0.035, 0.8, 8]} /><meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.35} /></mesh>
          </group>
        ))}
      </group></group>
      {/* orbit lanes: a faint wide band with a brighter centre line */}
      {ORBIT_R.map((r) => (
        <group key={r} rotation-x={-Math.PI / 2}>
          <mesh><ringGeometry args={[r - 0.07, r + 0.07, 160]} /><meshBasicMaterial color="#8b5cf6" transparent opacity={0.07} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
          <mesh><ringGeometry args={[r - 0.008, r + 0.008, 160]} /><meshBasicMaterial color="#c4b5fd" transparent opacity={0.22} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
        </group>
      ))}
      <directionalLight position={[5, 6, 4]} intensity={1.6} color="#ddd6fe" />
      <directionalLight position={[-6, -2, -5]} intensity={0.8} color="#67e8f9" />
      <pointLight intensity={2} decay={0} color="#ddd6fe" />
    </group>
  );
}

type Pos = () => THREE.Object3D | null | undefined;
/** Data stream: hub → agent (working) or, with `source`, agent → agent (team hand-off). A faint line plus a few particles riding it. */
function Beam({ target, source, color, glow, count, reduced, strength = 1 }: { target: Pos; source?: Pos; color: string; glow: THREE.Texture; count: number; reduced: boolean; strength?: number }) {
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: clamp(0.22 * strength, 0, 0.6), blending: THREE.AdditiveBlending, depthWrite: false }));
    l.frustumCulled = false;
    return l;
  }, [color, strength]);
  const pts = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3)); return g; }, [count]);
  useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }, [line]);
  useEffect(() => () => pts.dispose(), [pts]);
  useFrame(({ clock }) => {
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
      <points geometry={pts} frustumCulled={false}><pointsMaterial map={glow} size={0.14 * clamp(strength, 0.5, 1.6)} color={color} transparent opacity={clamp(0.85 * strength, 0, 1)} blending={THREE.AdditiveBlending} depthWrite={false} /></points>
    </>
  );
}

function Module({ agent, i, n, status, selected, reduced, lite, core, glow, groups, onPick, onHover }: {
  agent: Agent; i: number; n: number; status: AgentStatus; selected: boolean; reduced: boolean; lite: boolean;
  core: THREE.Texture | null; glow: THREE.Texture; groups: Map<string, THREE.Group>;
  onPick: (slug: string) => void; onHover: (slug: string | null, x: number, y: number) => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const slug = agent.slug;
  const setRef = useCallback((g: THREE.Group | null) => { ref.current = g; if (g) groups.set(slug, g); else groups.delete(slug); }, [groups, slug]);
  const toMe = useCallback(() => ref.current, []);
  const gem = useRef<THREE.Mesh>(null);
  const arm = useRef<THREE.Group>(null);
  const body = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.SpriteMaterial>(null);
  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  const shown = useRef<{ c: string; m: unknown }>({ c: "", m: null }); // Color.set() parses strings: only call it on change (or a new material)
  useFrame(({ clock }) => {
    const t = reduced ? 0 : clock.elapsedTime;
    if (ref.current) { orbitPos(i, n, t, ref.current.position); arm.current?.lookAt(ref.current.position); }
    if (gem.current) gem.current.rotation.y = t * 0.6;
    const g = statusGlow(status, agent.color, clock.elapsedTime, reduced);
    const v = statusVisual(status, clock.elapsedTime, reduced);
    if (g.color !== shown.current.c || body.current !== shown.current.m) { shown.current = { c: g.color, m: body.current }; body.current?.emissive.set(g.color); halo.current?.color.set(g.color); }
    if (body.current) body.current.emissiveIntensity = clamp(g.intensity, 0, 2);
    if (gem.current) gem.current.scale.setScalar(v.scale);
    if (halo.current) halo.current.opacity = v.halo;
    if (beacon.current) beacon.current.opacity = v.beacon;
  });
  return (
    <>
      {/* docking arm from the core toward this drone */}
      <group ref={arm}>
        <mesh position-z={1.2} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.022, 0.03, 0.75, 8]} /><meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.35} /></mesh>
        <mesh position-z={1.58}><sphereGeometry args={[0.04, 10, 10]} /><meshBasicMaterial color={agent.color} toneMapped={false} /></mesh>
      </group>
      {status === "working" && <Beam target={toMe} color={agent.color} glow={glow} count={lite ? 4 : 8} reduced={reduced} />}
      <group ref={setRef}>
        <mesh ref={gem}
          onClick={(e) => { e.stopPropagation(); if (e.delta <= 5) onPick(agent.slug); }}
          onPointerMove={(e) => { e.stopPropagation(); onHover(agent.slug, e.nativeEvent.clientX, e.nativeEvent.clientY); }}
          onPointerOut={(e) => onHover(null, e.nativeEvent.clientX, e.nativeEvent.clientY)}>
          <octahedronGeometry args={[0.26, 0]} />
          <meshStandardMaterial key={core ? "map" : "plain"} ref={body} map={core} emissiveMap={core} color={agent.color} emissive={agent.color} emissiveIntensity={0.2} flatShading metalness={0.45} roughness={0.25} />
        </mesh>
        <mesh rotation-x={Math.PI / 2}><torusGeometry args={[0.38, 0.012, 6, 48]} /><meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.25} /></mesh>
        <sprite scale={1.4}><spriteMaterial ref={halo} map={glow} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} /></sprite>
        {status === "waiting" && <mesh position-y={0.5}><sphereGeometry args={[0.06, 12, 12]} /><meshBasicMaterial ref={beacon} color="#fbbf24" transparent toneMapped={false} /></mesh>}
        {selected && <mesh rotation-x={Math.PI / 2}><torusGeometry args={[0.62, 0.012, 8, 64]} /><meshBasicMaterial color="#e9d5ff" /></mesh>}
      </group>
    </>
  );
}

/** One place for the shared textures, so every drone reuses one upload. */
function Station({ list, status, selected, reduced, lite, dust, handoffs, onPick, onHover }: {
  list: Agent[]; status: Record<string, AgentStatus>; selected: string | null; reduced: boolean; lite: boolean; dust: number; handoffs: [string, string][];
  onPick: (slug: string) => void; onHover: (slug: string | null, x: number, y: number) => void;
}) {
  const hull = useTex(HULL, 2), core = useTex(CORE), glow = useGlowTexture();
  const groups = useMemo(() => new Map<string, THREE.Group>(), []);
  const color = (slug: string) => list.find((a) => a.slug === slug)?.color ?? "#c4b5fd";
  return (
    <>
      <Sky />
      <Dust count={dust} glow={glow} reduced={reduced} />
      <Hub reduced={reduced} lite={lite} hull={hull} />
      {list.map((a, i) => <Module key={a.slug} agent={a} i={i} n={list.length} status={status[a.slug]} selected={a.slug === selected} reduced={reduced} lite={lite} core={core} glow={glow} groups={groups} onPick={onPick} onHover={onHover} />)}
      {/* team hand-off: previous step's drone → current step's drone */}
      {handoffs.map(([from, to]) => <Beam key={`${from}>${to}`} source={() => groups.get(from)} target={() => groups.get(to)} color={color(to)} glow={glow} count={lite ? 5 : 10} reduced={reduced} strength={1.4} />)}
    </>
  );
}

/** Follows the selected module: the orbit target tracks it (camera keeps its offset), with a one-time ease in on selection. */
function Follow({ index, n, reduced }: { index: number; n: number; reduced: boolean }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ({ target: THREE.Vector3; minDistance: number; maxDistance: number } & THREE.EventDispatcher<{ start: object }>) | null;
  const goal = useRef<number | null>(null);
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), d: new THREE.Vector3() }), []);
  useEffect(() => {
    goal.current = index >= 0 ? 5 : HOME;
    const stop = () => { goal.current = null; };
    controls?.addEventListener("start", stop);
    return () => controls?.removeEventListener("start", stop);
  }, [index, controls]);
  useFrame(({ clock }, dt) => {
    if (!controls) return;
    const p = index >= 0 ? orbitPos(index, n, reduced ? 0 : clock.elapsedTime, tmp.p) : tmp.p.set(0, 0, 0);
    const before = tmp.d.copy(controls.target);
    controls.target.lerp(p, reduced ? 1 : 1 - Math.exp(-6 * dt));
    camera.position.add(before.sub(controls.target).negate()); // move with the target
    if (goal.current === null) return;
    const off = tmp.d.copy(camera.position).sub(controls.target), d = off.length();
    if (!(d > 0)) return;
    const next = reduced ? goal.current : THREE.MathUtils.damp(d, goal.current, 4, dt);
    camera.position.copy(controls.target).addScaledVector(off, next / d);
    if (Math.abs(next - goal.current) < 0.01 * goal.current) goal.current = null;
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

type Props = { flat?: boolean; onClose: () => void; reduced: boolean; quality?: QualityMode; onOpenTask?: (id: string) => void; focusGoal?: string | null; radarUrl?: string | null; onRadarDone?: () => void };

export default function AgentsStation({ flat, onClose, reduced, quality = "auto", onOpenTask, focusGoal, radarUrl, onRadarDone }: Props) {
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
  useEffect(() => () => { document.body.style.cursor = ""; }, []);

  const list = useMemo(() => agents ?? [], [agents]);
  // A team's parent row (agent nova, "running" for the whole chain) is bookkeeping, not Nova's own work.
  const status = useMemo(() => { const own = tasks.filter((t) => !t.title.startsWith(CHAIN_TITLE)); return Object.fromEntries(list.map((a) => [a.slug, agentStatus(own, a.slug, a.stats.running)])) as Record<string, AgentStatus>; }, [list, tasks]);
  const names = useMemo(() => Object.fromEntries(list.map((a) => [a.slug, a.name])), [list]);
  const feed = useMemo(() => activityFeed(tasks, 10), [tasks]);
  const agent = list.find((a) => a.slug === selected) ?? null;
  const hovered = list.find((a) => a.slug === hover.id);
  // shortcut: "auto" uses the medium level (no FPS adaptation like Galaxy); add stepQuality if the station ever stutters.
  const q = QUALITY[quality === "low" ? 0 : quality === "high" ? 2 : 1];

  return (
    <div className="absolute inset-0 globe-in">
      {!flat && <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={visible ? "always" : "never"} camera={{ position: [0, HOME * 0.45, HOME], fov: 42 }}
        dpr={[1, q.dpr]} gl={{ antialias: true, powerPreference: "high-performance" }} onPointerMissed={() => setSelected(null)}>
        <color attach="background" args={["#03020c"]} />
        <Stars radius={70} depth={40} count={reduced ? Math.min(1500, q.stars) : q.stars} factor={2.4} fade speed={reduced ? 0 : 0.35} />
        <ambientLight intensity={0.35} />
        <Station list={list} status={status} selected={selected} reduced={reduced} lite={q.bloom === 0} dust={q.bloom === 0 ? 120 : q.bloom < 0.9 ? 350 : 700} handoffs={handoffs} onPick={setSelected} onHover={onHover} />
        <OrbitControls makeDefault enablePan={false} minDistance={2} maxDistance={HOME * 2.5} enableDamping dampingFactor={0.06} rotateSpeed={0.45} zoomSpeed={0.6} />
        <Follow index={list.findIndex((a) => a.slug === selected)} n={list.length} reduced={reduced} />
        <Rig />
        <ZoomRig home={HOME * Math.hypot(1, 0.45)} reduced={reduced} />
        {q.bloom > 0 && (
          <EffectComposer multisampling={q.msaa}>
            <Bloom intensity={reduced ? 0.3 : 0.55 * q.bloom} luminanceThreshold={0.75} luminanceSmoothing={0.3} mipmapBlur />
            <Vignette offset={0.25} darkness={0.75} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
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
            <div className="hud-title">AGENTS STATION</div>
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

