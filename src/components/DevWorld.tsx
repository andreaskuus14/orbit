"use client";
// CREATION → GAME DEV in the planet look (design language + MIX): one calm shell on the left (ask box, Needs you, Working on it,
// your games), the forge world on the right with real data (island size = stage, swarm = open bugs). Every tool loads on demand
// (React.lazy) from the "All tools" sheet and is mounted only while open (the playtest bot and the code helper stay once opened,
// so a run or a fix draft isn't lost). Deletes happen at once with Undo in a toast. Nothing here publishes anything.
import { WarmCompile } from "./WarmCompile";
import { Suspense, forwardRef, lazy, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useGlRecovery } from "./useGlRecovery";
import type { QualityMode } from "@/lib/quality-pure";
import { useLeanQuality } from "./useLeanQuality";
import { FrameMark } from "./dev-timing";
import { ZoomRig } from "./ZoomRig";
import { DEV_TAB_EVENT, DEV_TAB_KEY } from "@/lib/herald-pure";
import { LUAU_FIX_EVENT } from "@/lib/screen-look-pure";
import DevTrail from "./DevTrail";
import { useT } from "./i18n";
import { ContractCard, WorkStepsLine } from "./GameDevViews";
import { contractBrief } from "@/lib/gamedev-pure";
import { backlogGoal, fixContext, importDrafts, parseBacklog, sortBacklog } from "@/lib/backlog-pure";
import {
  ART_KEYS, KINDS, PLATFORMS, PRIORITIES, SEVERITIES, STAGES, STATUSES, bugStats, isActive, qaPrompt, slugify, validateDevWorld,
  type Bug, type DevWorld as World, type Game, type Kind, type Platform, type Priority, type Severity, type Stage, type Status,
} from "@/lib/devworld-pure";
import { KEEP_TOOLS, TOOL_GROUPS, counts, isGameTask, needsGame as toolNeedsGame, removeBug, removeGame, restore, urgentBugs, type Removed, type ToolId } from "@/lib/gamedev-shell-pure";
import { planetNeeds, type Need } from "@/lib/needs-you-pure";
import { fromTask, type Progress } from "@/lib/progress-pure";
import type { Key } from "@/lib/i18n-pure";
import { Button, Card, Chip, Empty, ErrorState, Loading, PlanetShell, Row, Section, Sheet, Toaster, WorkCard, IconBack, IconChevron, IconPlus, toast, type MenuItem } from "./ui";
import { VOICE_ASK } from "./voice/bus";
import { openTarget } from "./NeedsYou";
import { openProgress } from "./ProgressCard";
import { freshJson, usePoll } from "./use-poll";
import { PlanetBoundary } from "./PlanetBoundary";
import "@/app/gamedev-planet.css";

// Tools load on demand: each is its own chunk, fetched the first time he opens it.
type Any = ComponentType<Record<string, unknown>>;
const named = <M,>(load: () => Promise<M>, pick: (m: M) => unknown) => lazy(async () => ({ default: pick(await load()) as Any }));
const TOOLS = {
  RefBoard: lazy(() => import("./RefBoard")), SoundFinder: lazy(() => import("./SoundFinder")), ThumbMaker: lazy(() => import("./ThumbMaker")),
  TrendRadar: lazy(() => import("./TrendRadar")), CodeHelper: lazy(() => import("./CodeHelper")), RojoPanel: lazy(() => import("./RojoPanel")),
  ScenePlanner: lazy(() => import("./ScenePlanner")), TextureStudio: lazy(() => import("./TextureStudio")),
  PictureTo3D: named(() => import("./LocalAi"), (m) => m.PictureTo3D), TextTo3D: named(() => import("./LocalAi"), (m) => m.TextTo3D),
  MakeInBlender: named(() => import("./BlenderEntry"), (m) => m.MakeInBlender),
  PlaytestBot: lazy(() => import("./PlaytestBot")), PersonaPlaytest: lazy(() => import("./PersonaPlaytest")), AiPlaytesters: lazy(() => import("./AiPlaytesters")),
  GameCopilot: lazy(() => import("./GameCopilot")), GridCity: lazy(() => import("./GridCity")), HivePanel: lazy(() => import("./HivePanel")),
  DevSessions: lazy(() => import("./DevSessions")), CoreConfigPanel: lazy(() => import("./CoreConfigPanel")),
  EvidenceLog: named(() => import("./GameDevViews"), (m) => m.EvidenceLog), AssetRegister: named(() => import("./GameDevViews"), (m) => m.AssetRegister),
  ReleasePanel: named(() => import("./GameDevViews"), (m) => m.ReleasePanel), UiKitCard: named(() => import("./GameDevViews"), (m) => m.UiKitCard),
  EconomySim: named(() => import("./GameDevViews"), (m) => m.EconomySim), RetentionPanel: named(() => import("./GameDevViews"), (m) => m.RetentionPanel),
};

// CREATION → Game-dev world: a small "studio system" where each of the owner's games is a little world circling a forge star,
// with its open bugs swarming it. Data: /api/devworld (one game_saves row). No custom shaders: built-in materials only,
// so Bloom never sees NaN/negative output.

const PLATFORM_COLOR: Record<Platform, string> = { roblox: "#60a5fa", web: "#c084fc", other: "#5eead4" };
const STAGE_SIZE: Record<Stage, number> = { idea: 0.18, prototype: 0.24, alpha: 0.3, beta: 0.36, live: 0.42 };
const SEVERITY_COLOR: Record<Severity, string> = { crash: "#ff4d6d", major: "#ef4444", minor: "#f59e0b", polish: "#94a3b8" };
const MAX_PARTICLES = 300;
const orbitR = (i: number) => 2.3 + i * 0.75;

/** Where game i is at time t (written into `out`). */
function gamePos(i: number, t: number, out: THREE.Vector3) {
  const r = orbitR(i), a = i * 2.39996 + (t * 0.35) / Math.sqrt(r); // golden-angle spread, outer worlds slower
  return out.set(Math.cos(a) * r, Math.sin(i * 1.7) * 0.25, Math.sin(a) * r);
}

/* ---------- scene ---------- */

function ForgeStar({ reduced }: { reduced: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => { if (ring.current && !reduced) ring.current.rotation.z += dt * 0.3; });
  return (
    <group>
      <mesh><sphereGeometry args={[0.65, 48, 48]} /><meshBasicMaterial color={[2, 1.15, 0.45]} toneMapped={false} /></mesh>
      <mesh ref={ring} rotation-x={Math.PI / 2.4}><torusGeometry args={[1, 0.015, 8, 96]} /><meshBasicMaterial color="#fdba74" transparent opacity={0.5} /></mesh>
      <pointLight intensity={2.4} decay={0} color="#ffd8a8" />
    </group>
  );
}

function OrbitPath({ r }: { r: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2}>
      <ringGeometry args={[r - 0.006, r + 0.006, 128]} />
      <meshBasicMaterial color="#67e8f9" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function Island({ game, i, selected, reduced, onPick, onHover }: {
  game: Game; i: number; selected: boolean; reduced: boolean;
  onPick: (id: string) => void; onHover: (id: string | null, x: number, y: number) => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const size = STAGE_SIZE[game.stage], color = PLATFORM_COLOR[game.platform];
  useFrame(({ clock }) => {
    if (!ref.current) return;
    gamePos(i, reduced ? 0 : clock.elapsedTime, ref.current.position);
    if (!reduced) ref.current.rotation.y = clock.elapsedTime * 0.2;
  });
  return (
    <group ref={ref}>
      <mesh
        onClick={(e) => { e.stopPropagation(); if (e.delta <= 5) onPick(game.id); }}
        onPointerMove={(e) => { e.stopPropagation(); onHover(game.id, e.nativeEvent.clientX, e.nativeEvent.clientY); }}
        onPointerOut={(e) => onHover(null, e.nativeEvent.clientX, e.nativeEvent.clientY)}>
        <icosahedronGeometry args={[size, 1]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.5 : 0.18} flatShading roughness={0.7} />
      </mesh>
      {selected && <mesh rotation-x={Math.PI / 2}><torusGeometry args={[size + 0.12, 0.012, 8, 64]} /><meshBasicMaterial color="#a5f3fc" /></mesh>}
    </group>
  );
}

/** One instanced mesh for every active bug: each circles its game on its own tilted orbit. */
function BugSwarm({ games, bugs, reduced }: { games: Game[]; bugs: Bug[]; reduced: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => {
    const index = new Map(games.map((g, i) => [g.id, i]));
    return bugs.filter(isActive).slice(0, MAX_PARTICLES).flatMap((b, k) => {
      const gi = index.get(b.game);
      if (gi === undefined) return [];
      const h = (k * 0.618034) % 1; // deterministic spread, no Math.random so it doesn't jump on re-render
      return [{ gi, sev: b.severity, rad: STAGE_SIZE[games[gi].stage] + 0.16 + h * 0.18, phase: k * 2.1, speed: 1.1 + h, tilt: (h - 0.5) * 2.2, scale: b.severity === "crash" ? 1.5 : 1 }];
    });
  }, [games, bugs]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const c = new THREE.Color();
    parts.forEach((p, k) => m.setColorAt(k, c.set(SEVERITY_COLOR[p.sev])));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [parts]);
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), g: new THREE.Vector3(), v: new THREE.Vector3(), x: new THREE.Vector3(1, 0, 0) }), []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = reduced ? 0 : clock.elapsedTime;
    parts.forEach((p, k) => {
      const a = p.phase + t * p.speed;
      tmp.v.set(Math.cos(a) * p.rad, 0, Math.sin(a) * p.rad).applyAxisAngle(tmp.x, p.tilt);
      tmp.o.position.copy(gamePos(p.gi, t, tmp.g)).add(tmp.v);
      tmp.o.scale.setScalar(p.scale);
      tmp.o.updateMatrix();
      m.setMatrixAt(k, tmp.o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  if (!parts.length) return null;
  // key: the instance count is fixed at creation, so a new count needs a new mesh (R3F disposes the old one).
  return (
    <instancedMesh key={parts.length} ref={ref} args={[undefined, undefined, parts.length]} frustumCulled={false}>
      <sphereGeometry args={[0.035, 8, 8]} />
      <meshBasicMaterial />
    </instancedMesh>
  );
}

/** Keeps the system clear of the left-hand shell on wide screens. */
function Rig() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    if (size.width >= 900) camera.setViewOffset(size.width, size.height, -220, 0, size.width, size.height); // the shell sits on the left
    else camera.clearViewOffset();
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

/* ---------- data + UI ---------- */

type Props = { paused?: boolean /* kept mounted but hidden */; flat?: boolean; onClose: () => void; reduced: boolean; quality?: QualityMode; onOpenTask?: (id: string) => void };
type K = (key: string, vars?: Record<string, string | number>) => string;

// A screen-look "Fix with docs" fires before GAME DEV mounts: hold the error until the panel takes it.
let pendingFix = "";
if (typeof window !== "undefined") addEventListener(LUAU_FIX_EVENT, (e) => { pendingFix = String((e as CustomEvent<string>).detail ?? ""); });

type TipHandle = { move: (id: string | null, x: number, y: number) => void };
/** The island tooltip keeps its own state, so hovering re-renders only this span, not the Canvas or the shell. */
const HoverTip = forwardRef<TipHandle, { label: (id: string) => string | null }>(function HoverTip({ label }, ref) {
  const [h, setH] = useState<{ id: string | null; x: number; y: number }>({ id: null, x: 0, y: 0 });
  useImperativeHandle(ref, () => ({ move: (id, x, y) => setH((p) => (p.id === id && Math.abs(p.x - x) < 2 && Math.abs(p.y - y) < 2 ? p : { id, x, y })) }), []);
  const text = h.id ? label(h.id) : null;
  if (!text) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="globe-tip" style={{ transform: `translate(${h.x + 14}px, ${h.y + 12}px)` }}>{text}</span>
    </div>
  );
});

type GameTask = { id: string; agent: string; title: string; status: string; created_at: string; started_at?: string | null; finished_at?: string | null };

export default function DevWorld({ onClose, reduced, onOpenTask, flat, quality = "auto", paused = false }: Props) {
  const q = useLeanQuality(quality);
  const glr = useGlRecovery();
  const { t, lang } = useT();
  const k: K = useCallback((key, vars) => t(key as Key, vars), [t]);
  const openTask = useMemo(() => onOpenTask ?? ((id: string) => openProgress(`#o=operations&k=task&id=${encodeURIComponent(id)}`)), [onOpenTask]);
  const [world, setWorld] = useState<World | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<ToolId>>(new Set()); // keep-tools mounted once opened
  const [toolsOpen, setToolsOpen] = useState(false);
  const tip = useRef<TipHandle>(null);
  const open = useCallback((id: ToolId | null) => { setTool(id); setToolsOpen(false); if (id && KEEP_TOOLS.includes(id)) setOpened((s) => (s.has(id) ? s : new Set(s).add(id))); }, []);

  const [sites, setSites] = useState<{ slug: string; mtime: number; preview: string }[] | null | "err">(null); // CORE's built sites, shown as results
  const loadSites = useCallback(() => { fetch("/api/workspace", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((j) => setSites(j.workspaces ?? []), () => setSites("err")); }, []);
  useEffect(() => { if (!paused) loadSites(); }, [paused, loadSites]);

  const [fix, setFix] = useState<{ key: number; error: string } | undefined>(); // backlog → Code helper (Fix mode)
  const [rising, setRising] = useState(0); // bumped by a Herald trend card: Trend Radar opens on Rising
  useEffect(() => { if (tool !== "trends") setRising(0); }, [tool]);
  useEffect(() => {
    const go = () => { open("trends"); setRising((n) => n + 1); };
    try { if (sessionStorage.getItem(DEV_TAB_KEY) === "trends") { sessionStorage.removeItem(DEV_TAB_KEY); go(); } } catch { /* no storage: the event still works */ }
    addEventListener(DEV_TAB_EVENT, go);
    return () => removeEventListener(DEV_TAB_EVENT, go);
  }, [open]);
  useEffect(() => {
    const take = () => { if (pendingFix) { setFix({ key: Date.now(), error: pendingFix }); open("code"); pendingFix = ""; } };
    take();
    addEventListener(LUAU_FIX_EVENT, take);
    return () => removeEventListener(LUAU_FIX_EVENT, take);
  }, [open]);

  const saved = useRef<World | null>(null); // last world the server accepted: the rollback target
  const latest = useRef<World | null>(null); // what's on screen now: Undo restores into this, so later edits stay
  latest.current = world;
  const queue = useRef(Promise.resolve());
  const seq = useRef(0);
  const epoch = useRef(0);
  const base = useRef<string | null>(null); // server updatedAt this tab last saw: sent with each save to detect other tabs

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const res = await fetch("/api/devworld", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(res.status));
      saved.current = json.world; base.current = json.updatedAt ?? null; setWorld(json.world); setSeeded(!!json.seeded);
    } catch { setLoadErr(true); }
  }, []);
  useEffect(() => { if (!paused) queue.current = queue.current.then(load); }, [load, paused]); // each visit refreshes, after any queued save

  /** Optimistic: show `next` now; PUTs run in order so the server never applies an older world after a newer one. */
  const commit = useCallback((next: World) => {
    const v = validateDevWorld(next);
    if (!v.ok) { setErr(v.error); return false; }
    setErr(""); setWorld(v.world); latest.current = v.world;
    const n = ++seq.current, ep = epoch.current;
    queue.current = queue.current.then(async () => {
      if (ep !== epoch.current) return; // queued before a reload: built on a stale world
      try {
        const res = await fetch("/api/devworld", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ world: v.world, base: base.current }) });
        const json = await res.json().catch(() => ({}));
        if (res.status === 409) { epoch.current++; await load(); setErr(k("gx.conflict")); return; } // drop this tab's stale edit
        if (!res.ok) throw new Error(String(res.status));
        saved.current = json.world ?? v.world; base.current = json.updatedAt ?? base.current; setSeeded(false);
        if (n === seq.current) setErr("");
      } catch {
        if (n === seq.current) { setErr(k("gx.saveErr")); if (saved.current) setWorld(saved.current); } // otherwise a later queued save carries this change anyway
      }
    });
    return true;
  }, [load, k]);

  /** Delete at once; Undo in the toast puts it back into the world as it is then (not a stale copy). */
  const undoable = useCallback((r: { world: World; removed: Removed }, text: string, id: string) => {
    if (!commit(r.world)) return false;
    toast({ id, text, action: { label: k("gx.undo"), onClick: () => { const w = latest.current; if (w && commit(restore(w, r.removed))) toast({ id, text: k("gx.restored"), tone: "done" }); } } });
    return true;
  }, [commit, k]);
  const deleteGame = useCallback((g: Game) => { const w = latest.current; if (w && undoable(removeGame(w, g.id), k("gx.deleted", { name: g.name }), `gd-del-${g.id}`)) { setSelected(null); open(null); } }, [undoable, k, open]);
  const deleteBug = useCallback((b: Bug) => { const w = latest.current; if (w) undoable(removeBug(w, b.id), k("gx.bugDeleted"), `gd-del-${b.id}`); }, [undoable, k]);

  const onHover = useCallback((id: string | null, x: number, y: number) => { tip.current?.move(id, x, y); document.body.style.cursor = id ? "pointer" : ""; }, []);
  useEffect(() => () => { document.body.style.cursor = ""; }, [paused]); // leaving mid-hover must not keep the hand cursor

  /* ---- Needs you (shared list for this planet) + Working on it (QA playtests started here) ---- */
  const [needs, setNeeds] = useState<Need[] | null>(null);
  const loadNeeds = useCallback(() => {
    void freshJson<{ items?: Need[] }>(`/api/needs-you?lang=${lang}`).then((j) => setNeeds(planetNeeds("creation", j?.items ?? []).own));
  }, [lang]);
  usePoll(loadNeeds, 30_000, !paused);
  const [tasks, setTasks] = useState<GameTask[] | null>(null);
  const loadTasks = useCallback(() => {
    fetch("/api/tasks?fields=status", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { tasks: [] }))
      .then((j: { tasks?: GameTask[] }) => setTasks((j.tasks ?? []).filter(isGameTask)), () => setTasks([]));
  }, []);
  const anyRunning = !!tasks?.some((x) => x.status === "running" || x.status === "queued");
  usePoll(loadTasks, anyRunning ? 5000 : 20_000, !paused);
  const work = useMemo(() => (tasks ?? []).map((x) => fromTask(x, lang, { nowMs: Date.now() })), [tasks, lang]);
  const active = work.filter((p) => p.phase !== "done" && p.phase !== "failed"), failed = work.filter((p) => p.phase === "failed").slice(0, 2), finished = work.filter((p) => p.phase === "done").slice(0, 2);

  const games = useMemo(() => world?.games ?? [], [world]);
  const bugs = useMemo(() => world?.bugs ?? [], [world]);
  const game = games.find((g) => g.id === selected) ?? null;
  const c = counts(world);
  const urgent = useMemo(() => urgentBugs(world, 2), [world]); // the worst two; the rest are one click away in the game
  const gk = game?.id ?? ""; // game-scoped tools remount on a game switch, so no tool keeps the previous game's context
  const lastGk = useRef(gk);
  useEffect(() => { if (lastGk.current !== gk) { lastGk.current = gk; setFix(undefined); } }, [gk]); // a fix prompt never follows you to another game
  const far = Math.max(9, orbitR(games.length) * 1.5);
  const pickGame = useCallback((id: string) => { setSelected(id); open(null); setAdding(false); }, [open]);
  const tipLabel = useCallback((id: string) => { const g = games.find((x) => x.id === id); return g && world ? k("gx.tip", { name: g.name, n: bugStats(world, g.id).active }) : null; }, [games, world, k]);

  const status = !world ? (loadErr ? k("gx.errTitle") : k("gx.loading")) : c.games ? k("gx.status", { g: c.games, b: c.open }) : k("gx.statusNone");
  const menu: MenuItem[] = [
    { label: k("gx.allTools"), onSelect: () => setToolsOpen(true) },
    { label: k("gx.addGame"), onSelect: () => { setSelected(null); open(null); setAdding(true); }, disabled: !world || games.length >= 30 },
  ];
  const needCount = Math.min(needs?.length ?? 0, 3) + urgent.length + failed.length;
  const toolLabel = tool ? k(`gx.t.${tool}`) : "";
  const home = !tool && !game && !adding;

  return (
    <div className="gamedev absolute inset-0 globe-in" aria-label={k("gx.title")}>
      {!flat && <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={paused ? "never" : "always"} camera={{ position: [0, far * 0.45, far], fov: 42 }}
        dpr={[1, q.dpr]} gl={{ antialias: false, powerPreference: "high-performance" }}>
        <WarmCompile world="creation" />
        {quality === "auto" && <PerformanceMonitor onDecline={q.onDecline} />}
        <color attach="background" args={["#02030a"]} />
        <Stars radius={70} depth={40} count={reduced ? Math.min(1500, q.stars) : q.stars} factor={2.4} fade speed={reduced ? 0 : 0.35} />
        <ambientLight intensity={0.35} />
        <ForgeStar reduced={reduced} />
        {games.map((g, i) => <OrbitPath key={`p-${g.id}`} r={orbitR(i)} />)}
        {games.map((g, i) => <Island key={g.id} game={g} i={i} selected={g.id === selected} reduced={reduced} onPick={pickGame} onHover={onHover} />)}
        <BugSwarm games={games} bugs={bugs} reduced={reduced} />
        <OrbitControls makeDefault enablePan={false} minDistance={3} maxDistance={far * 2} enableDamping dampingFactor={0.06} rotateSpeed={0.45} zoomSpeed={0.6} />
        <Rig />
        {!paused && <ZoomRig home={far * Math.hypot(1, 0.45)} reduced={reduced} />}
        {q.bloomScale > 0 && (
          <EffectComposer multisampling={q.msaa}>
            <Bloom intensity={(reduced ? 0.3 : 0.5) * q.bloomScale} luminanceThreshold={0.75} luminanceSmoothing={0.3} mipmapBlur />
            <Vignette offset={0.25} darkness={0.75} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )}
        {process.env.NODE_ENV === "development" && <FrameMark name="creation" />}
      </Canvas>}

      <HoverTip ref={tip} label={tipLabel} />
      {world && c.games > 0 && <p className="pu gd-caption pu-num" data-planet="creation" aria-hidden="true">{(() => { const n = bugs.filter((b) => isActive(b) && b.severity === "crash").length; return n ? k("gx.caption", { g: c.games, b: c.open, c: n }) : k("gx.status", { g: c.games, b: c.open }); })()}</p>}

      <div className="gd-wrap">
      <PlanetShell planet="creation" className="gd-shell" title={k("gx.title")} status={status}
        menu={menu} menuLabel={k("gx.more")} onClose={onClose} closeLabel={k("gx.close")} closeClassName="world-back"
        ask={home ? { label: k("gx.askLabel"), placeholder: k("gx.askPh"), sendLabel: k("gx.send"), suggestions: [k("ph.creation.ex1"), k("ph.creation.ex2"), k("ph.creation.ex3")],
          onSubmit: (text) => { dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text } })); } } : undefined}
        sheet={<ToolsSheet open={toolsOpen} k={k} hasGame={!!game} onClose={() => setToolsOpen(false)} onPick={open} />}>

        {err && <p className="gd-error" role="alert">{err}</p>}

        {!home && (
          <div className="gd-bar">
            <Button size="sm" variant="ghost" icon={<IconBack />} label={k("gx.backLabel")} onClick={() => { if (tool && game) open(null); else { open(null); setSelected(null); setAdding(false); } }} />
            <h3 className="gd-bar-title">{tool ? toolLabel : adding ? k("gx.addGame") : game?.name}</h3>
            {(tool ? toolNeedsGame(tool) : !!game) && games.length > 1 && (
              <select className="gd-pick" aria-label={k("gd.pickLabel")} value={selected ?? ""} onChange={(e) => e.target.value && setSelected(e.target.value)}>
                {!selected && <option value="">{k("gd.pickChoose")}</option>}
                {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </div>
        )}

        {home && <>
          {seeded && <p className="gd-note">{k("gx.starter")}</p>}
          <LocalBrainLine paused={paused} k={k} />
          <Section id="gd-needs" title={k("gx.needs")} count={needCount}>
            {!world && needs === null ? <Loading rows={1} label={k("gx.loading")} />
              : needCount === 0 ? <Empty title={k("gx.needsNone")} text={k("gx.needsNoneText")} />
              : <ul className="pu-list gd-needs">
                {(needs ?? []).slice(0, 3).map((n) => (
                  <Card key={n.ref} as="li" tone={n.cause === "failed" || n.cause === "blocked" ? "error" : "needs"} title={n.title} sub={n.detail ?? k(`needs.ask.${n.cause}`)}
                    actions={<Button size="sm" variant={n.kind === "decide" ? "primary" : "secondary"} onClick={() => openTarget(n.act.open, openTask, openTask)}>{k(n.kind === "decide" ? "gx.check" : "gx.open")}</Button>} />
                ))}
                {failed.map((p) => (
                  <Card key={p.id} as="li" tone="error" title={p.title} sub={p.result?.text}
                    actions={<Button size="sm" onClick={() => openTask(p.id)}>{k("gx.open")}</Button>} />
                ))}
                {urgent.map(({ bug, game: g }) => (
                  <Card key={bug.id} as="li" tone={bug.severity === "crash" ? "error" : "needs"} title={bug.title} sub={`${g.name} · ${k(`gx.sev.${bug.severity}`)}`}
                    actions={<Button size="sm" onClick={() => pickGame(g.id)}>{k("gx.openGame")}</Button>} />
                ))}
              </ul>}
          </Section>

          <Section id="gd-work" title={k("gx.working")} count={active.length}>
            {tasks === null ? <Loading rows={1} label={k("gx.loading")} />
              : active.length === 0 ? <Empty title={k("gx.workingNone")} text={k("gx.workingNoneText")} />
              : <ul className="pu-list">{active.slice(0, 3).map((p: Progress) => <WorkCard key={p.id} p={p} onAction={(a) => openProgress(a.open)} />)}</ul>}
          </Section>

          <Section id="gd-games" title={k("gx.results")} count={c.games || undefined}
            action={world && games.length < 30 ? <Button size="sm" variant="ghost" icon={<IconPlus />} onClick={() => setAdding(true)}>{k("gx.addGame")}</Button> : undefined}>
            {!world ? (loadErr ? <ErrorState title={k("gx.errTitle")} text={k("gx.errText")} retryLabel={k("gx.retry")} onRetry={() => void load()} /> : <Loading rows={3} label={k("gx.loading")} />)
              : !games.length ? <Empty title={k("gx.gamesNone")} text={k("gx.gamesNoneText")} action={<Button size="sm" variant="primary" onClick={() => setAdding(true)}>{k("gx.addGame")}</Button>} />
              : <ul className="pu-list">
                {finished.map((p) => <li key={p.id}><Row title={p.title} sub={p.result?.text ?? k("gx.done")} lead={<span className="pu-dot" data-tone="good" />} trail={<IconChevron />} onClick={() => openTask(p.id)} /></li>)}
                {games.map((g) => (
                  <li key={g.id}><Row title={g.name} sub={k("gx.gameSub", { stage: k(`gx.stage.${g.stage}`), n: bugStats(world, g.id).active })}
                    lead={<span className="gd-plat" style={{ background: PLATFORM_COLOR[g.platform] }} />} trail={<IconChevron />} onClick={() => pickGame(g.id)} /></li>
                ))}
              </ul>}
          </Section>

          {sites === "err" ? <Section id="gd-sites" title={k("gx.sites")}><ErrorState title={k("gx.sitesErr")} text={k("gx.sitesErrText")} retryLabel={k("gx.retry")} onRetry={loadSites} /></Section>
            : sites && sites.length > 0 && (
              <Section id="gd-sites" title={k("gx.sites")} count={sites.length}>
                <ul className="pu-list">{sites.slice(0, 5).map((w) => (
                  <li key={w.slug}><Row title={w.slug} sub={new Date(w.mtime).toLocaleDateString(lang === "et" ? "et-EE" : "en-GB")} lead={<span className="pu-dot" data-tone="accent" />} trail={<IconChevron />}
                    onClick={() => window.open(w.preview, "_blank", "noopener,noreferrer")} /></li>))}</ul>
              </Section>)}
        </>}

        {adding && !tool && world && (
          <GameForm k={k} taken={games.map((g) => g.id)} onCancel={() => setAdding(false)}
            onSave={(g) => { if (commit({ ...world, games: [...games, g] })) { setAdding(false); setSelected(g.id); } }} />
        )}

        {!tool && game && world && (
          <GameDetail key={game.id} k={k} game={game} world={world} commit={commit} onDelete={deleteGame} onDeleteBug={deleteBug} onOpenTask={openTask}
            onFix={(error) => { setFix({ key: Date.now(), error: `${contractBrief(game)}\n\n${error}`.slice(0, 2000) }); open("code"); }} onTasks={loadTasks} />
        )}

        {/* Tools: only the open one is mounted; the playtest bot and code helper stay once opened. */}
        <div className="gd-tool"><PlanetBoundary name="gamedev-tool">
          <Suspense fallback={<Loading rows={3} label={k("gx.toolLoading")} />}>
            {tool && toolNeedsGame(tool) && !game ? (
              !world ? <Loading rows={2} label={k("gx.loading")} />
                : !games.length ? <Empty title={k("gx.pickFirst")} text={k("gd.pickNone")} />
                : <Empty title={k("gx.pickFirst")} text={k("gd.pickHere")} />
            ) : tool && <ToolBody id={tool} k={k} game={game} world={world} commit={commit} gk={gk} rising={rising} />}
            {opened.has("playtest") && <div hidden={tool !== "playtest" || !game}><p className="gd-note">{k("gd.k.runtime")}: {k("gd.runtimeNote")}</p><TOOLS.PlaytestBot key={gk} world={world} commit={commit} gameId={selected} /></div>}
            {opened.has("code") && <div hidden={tool !== "code"}><TOOLS.CodeHelper key={gk} prefill={fix} /></div>}
          </Suspense>
        </PlanetBoundary></div>
      </PlanetShell>
      </div>
      <Toaster dismissLabel={k("gx.dismiss")} />
    </div>
  );
}

/** The one open tool (the keep-tools render above, outside this). */
function ToolBody({ id, k, game, world, commit, gk, rising }: { id: ToolId; k: K; game: Game | null; world: World | null; commit: (w: World) => boolean; gk: string; rising: number }) {
  const T = TOOLS, gameId = game?.id ?? null;
  const per = world && game ? { key: gk, game, world, commit } : null;
  switch (id) {
    case "refs": return <T.RefBoard />;
    case "sounds": return <T.SoundFinder />;
    case "thumbs": return <T.ThumbMaker />;
    case "trends": return <T.TrendRadar openRising={rising} />;
    case "grid": return <T.GridCity key={gk} />;
    case "hive": return <T.HivePanel />;
    case "scene": return <T.ScenePlanner key={gk} />;
    case "textures": return <T.TextureStudio />;
    case "model3d": return <T.PictureTo3D />;
    case "text3d": return <><T.TextTo3D /><T.MakeInBlender /></>;
    case "aitesters": return <T.AiPlaytesters />;
    case "personas": return <><p className="gd-note">{k("gd.k.simulated")}: {k("gd.simNote")}</p><T.PersonaPlaytest key={gk} world={world} commit={commit} gameId={gameId} /></>;
    case "economy": return <T.GameCopilot key={gk} world={world} gameId={gameId} />;
    case "files": return <T.RojoPanel />;
    case "sessions": return <T.DevSessions />;
    case "core": return <T.CoreConfigPanel />;
    case "evidence": return per && <T.EvidenceLog {...per} />;
    case "register": return per && <T.AssetRegister {...per} />;
    case "release": return per && <T.ReleasePanel {...per} />;
    case "uikit": return per && <T.UiKitCard {...per} />;
    case "sim": return per && <T.EconomySim {...per} />;
    case "retention": return per && <T.RetentionPanel {...per} />;
    default: return null; // playtest, code: kept, rendered by the parent
  }
}

/** "All tools": the 24 tools in six groups, plain names with one line on what each does. */
function ToolsSheet({ open, k, hasGame, onClose, onPick }: { open: boolean; k: K; hasGame: boolean; onClose: () => void; onPick: (id: ToolId) => void }) {
  return (
    <Sheet open={open} title={k("gx.allTools")} onClose={onClose} closeLabel={k("gx.close")}>
      {TOOL_GROUPS.map((g) => (
        <Section key={g.id} id={`gd-tg-${g.id}`} title={k(`gx.g.${g.id}`)}>
          <ul className="pu-list">{g.tools.map(([id, need]) => (
            <li key={id}><Row title={k(`gx.t.${id}`)} sub={need && !hasGame ? `${k(`gx.h.${id}`)} · ${k("gx.pickFirst")}` : k(`gx.h.${id}`)} trail={<IconChevron />} onClick={() => onPick(id as ToolId)} /></li>
          ))}</ul>
        </Section>
      ))}
    </Sheet>
  );
}

function Art({ game, k }: { game: Game; k: K }) {
  const [broken, setBroken] = useState(false);
  const c = PLATFORM_COLOR[game.platform];
  if (!game.art || broken) return <div aria-hidden className="gd-art" style={{ background: `linear-gradient(135deg, ${c}55, #0b1226 60%, ${c}22)` }} />;
  // eslint-disable-next-line @next/next/no-img-element -- small bundled art; next/image adds nothing here
  return <img src={`/devworld/${game.art}.webp`} alt={k("gx.d.art", { name: game.name })} className="gd-art" onError={() => setBroken(true)} />;
}

function GameDetail({ k, game, world, commit, onDelete, onDeleteBug, onOpenTask, onFix, onTasks }: {
  k: K; game: Game; world: World; commit: (w: World) => boolean; onDelete: (g: Game) => void; onDeleteBug: (b: Bug) => void;
  onOpenTask: (id: string) => void; onFix: (error: string) => void; onTasks: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [qa, setQa] = useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: "", ok: true });
  const setGame = (g: Game) => commit({ ...world, games: world.games.map((x) => (x.id === game.id ? g : x)) });
  const stats = bugStats(world, game.id);

  async function playtest() {
    setQa({ busy: true, msg: "", ok: true });
    try {
      const res = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "qa", title: `Playtest plan: ${JSON.stringify(game.name)}`, request: qaPrompt(game, world.bugs) }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      setQa({ busy: false, msg: k("gx.d.qaOn"), ok: true }); onTasks();
      if (json.task?.id) onOpenTask(json.task.id);
    } catch { setQa({ busy: false, msg: k("gx.d.qaErr"), ok: false }); }
  }

  if (editing) return <GameForm k={k} initial={game} taken={[]} onCancel={() => setEditing(false)} onSave={(g) => { if (setGame(g)) setEditing(false); }} />;
  return (
    <div className="gd-detail">
      <Art key={game.art} game={game} k={k} />
      <div className="gd-detail-head">
        <p className="pu-status">{k("gx.d.sub", { platform: k(`gx.plat.${game.platform}`), open: stats.active, total: stats.total })}</p>
        <label className="gd-inline">{k("gx.f.stage")}
          <select className="gd-pick" value={game.stage} onChange={(e) => setGame({ ...game, stage: e.target.value as Stage })}>
            {STAGES.map((s) => <option key={s} value={s}>{k(`gx.stage.${s}`)}</option>)}
          </select>
        </label>
      </div>
      {game.pitch && <p className="gd-text">{game.pitch}</p>}
      {game.notes && <p className="gd-note gd-pre">{game.notes}</p>}
      <div className="gd-actions">
        <Button variant="primary" busy={qa.busy} onClick={() => void playtest()}>{qa.busy ? k("gx.d.starting") : k("gx.d.playtest")}</Button>
        <Button onClick={() => setEditing(true)}>{k("gx.d.edit")}</Button>
        <Button variant="danger" onClick={() => onDelete(game)}>{k("gx.d.delete")}</Button>
      </div>
      {qa.msg && <p role="status" className={qa.ok ? "gd-note gd-ok" : "gd-error"}>{qa.msg}</p>}
      <div className="gd-tool"><ContractCard key={game.id} game={game} world={world} commit={commit} /></div>
      <BugTracker k={k} game={game} world={world} commit={commit} onFix={onFix} onDelete={onDeleteBug} />
    </div>
  );
}

function GameForm({ k, initial, taken, onSave, onCancel }: { k: K; initial?: Game; taken: string[]; onSave: (g: Game) => void; onCancel: () => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? "", platform: initial?.platform ?? ("roblox" as Platform), stage: initial?.stage ?? ("idea" as Stage),
    pitch: initial?.pitch ?? "", notes: initial?.notes ?? "", art: initial?.art ?? "",
  });
  const set = (key: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [key]: e.target.value });
  return (
    <form className="gd-form" aria-label={initial ? k("gx.f.edit") : k("gx.f.add")} onSubmit={(e) => {
      e.preventDefault();
      if (!f.name.trim()) return;
      const g: Game = { id: initial?.id ?? slugify(f.name, taken), name: f.name, platform: f.platform, stage: f.stage, pitch: f.pitch, notes: f.notes };
      if (f.art) g.art = f.art as Game["art"];
      onSave(g);
    }}>
      <label className="gd-label">{k("gx.f.name")}<input className="gd-field" required maxLength={60} value={f.name} onChange={set("name")} /></label>
      <div className="gd-row3">
        <label className="gd-label">{k("gx.f.platform")}<select className="gd-field" value={f.platform} onChange={set("platform")}>{PLATFORMS.map((p) => <option key={p} value={p}>{k(`gx.plat.${p}`)}</option>)}</select></label>
        <label className="gd-label">{k("gx.f.stage")}<select className="gd-field" value={f.stage} onChange={set("stage")}>{STAGES.map((s) => <option key={s} value={s}>{k(`gx.stage.${s}`)}</option>)}</select></label>
        <label className="gd-label">{k("gx.f.art")}<select className="gd-field" value={f.art} onChange={set("art")}><option value="">{k("gx.f.none")}</option>{ART_KEYS.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
      </div>
      <label className="gd-label">{k("gx.f.pitch")}<textarea className="gd-field" rows={2} maxLength={300} value={f.pitch} onChange={set("pitch")} /></label>
      <label className="gd-label">{k("gx.f.notes")}<textarea className="gd-field" rows={4} maxLength={4000} value={f.notes} onChange={set("notes")} /></label>
      <div className="gd-actions"><Button type="submit" variant="primary">{initial ? k("gx.f.save") : k("gx.f.add")}</Button><Button onClick={onCancel}>{k("gx.f.cancel")}</Button></div>
    </form>
  );
}

/** The game's backlog (roadmap 4.4): bugs, features and polish with priority and status; import a pasted list or GitHub issues text;
 *  any item → a Goal (the planner drafts its steps) or → the Luau helper's Fix mode, whose suggestion is checked against Roblox's docs. */
function BugTracker({ k, game, world, commit, onFix, onDelete }: { k: K; game: Game; world: World; commit: (w: World) => boolean; onFix: (error: string) => void; onDelete: (b: Bug) => void }) {
  const { lang } = useT();
  const [all, setAll] = useState(false);
  const [draft, setDraft] = useState({ title: "", severity: "major" as Severity, detail: "", kind: "bug" as Kind, priority: "medium" as Priority });
  const [paste, setPaste] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [goalBusy, setGoalBusy] = useState("");
  const mine = sortBacklog(world.bugs.filter((b) => b.game === game.id && (all || isActive(b))));
  const setBug = (id: string, patch: Partial<Bug>) => commit({ ...world, bugs: world.bugs.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const day = (iso: string) => new Date(iso).toLocaleDateString(lang === "et" ? "et-EE" : "en-GB");

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const bug: Bug = { id: crypto.randomUUID(), game: game.id, title: draft.title, detail: draft.detail, severity: draft.severity, status: "open", created: new Date().toISOString(), kind: draft.kind, priority: draft.priority };
    if (commit({ ...world, bugs: [...world.bugs, bug] })) setDraft({ ...draft, title: "", detail: "" });
  }

  function doImport() {
    const drafts = parseBacklog(paste ?? "");
    if (!drafts.length) { setNote({ ok: false, text: k("gx.b.importNone") }); return; }
    const r = importDrafts(world, game.id, drafts, new Date().toISOString(), () => crypto.randomUUID());
    if (commit(r.world)) { setPaste(null); setNote({ ok: true, text: r.skipped ? k("gx.b.importedSkip", { n: r.added, s: r.skipped }) : k("gx.b.imported", { n: r.added }) }); }
  }

  async function toGoal(b: Bug) {
    setGoalBusy(b.id); setNote(null);
    try {
      const r = await fetch("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(backlogGoal(game, b)) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error();
      setBug(b.id, { goalId: j.id });
      setNote({ ok: true, text: k("gx.b.goalOk") });
    } catch { setNote({ ok: false, text: k("gx.b.goalErr") }); } finally { setGoalBusy(""); }
  }

  return (
    <Section id="gd-bugs" title={k("gx.b.title")} count={mine.length}
      action={<span className="pu-chips" role="group" aria-label={k("gx.b.filter")}><Chip pressed={!all} onClick={() => setAll(false)}>{k("gx.b.open")}</Chip><Chip pressed={all} onClick={() => setAll(true)}>{k("gx.b.all")}</Chip></span>}>
      <ul className="pu-list gd-tool" aria-label={k("gx.b.label", { name: game.name })}>
        {mine.map((b) => (
          <li key={b.id} className="gd-bug" style={{ ["--sev" as string]: SEVERITY_COLOR[b.severity] }}>
            <div className="gd-bug-head">
              <p className="gd-bug-title">{b.title}{b.ref && <span className="gd-note"> {b.ref}</span>}</p>
              <span className="gd-sev">{k(`gx.kind.${b.kind ?? "bug"}`)} · {k(`gx.sev.${b.severity}`)}</span>
            </div>
            {b.detail && <p className="gd-note gd-pre">{b.detail}</p>}
            <WorkStepsLine bug={b} world={world} />
            <div className="gd-bug-meta">
              <select className="gd-pick" aria-label={k("gx.b.statusOf", { t: b.title })} value={b.status}
                onChange={(e) => { const status = e.target.value as Status; setBug(b.id, { status, fixed: status === "fixed" ? new Date().toISOString() : undefined }); }}>
                {STATUSES.map((s) => <option key={s} value={s}>{k(`gx.st.${s}`)}</option>)}
              </select>
              <select className="gd-pick" aria-label={k("gx.b.priorityOf", { t: b.title })} value={b.priority ?? "medium"} onChange={(e) => setBug(b.id, { priority: e.target.value as Priority })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{k(`gx.pri.${p}`)}</option>)}
              </select>
              <span className="gd-note">{b.fixed ? k("gx.b.fixedOn", { d: day(b.fixed) }) : k("gx.b.loggedOn", { d: day(b.created) })}</span>
            </div>
            <div className="gd-bug-actions">
              {b.goalId ? <span className="gd-note">{k("gx.b.goalMade")}</span>
                : <Button size="sm" busy={goalBusy === b.id} disabled={!!goalBusy && goalBusy !== b.id} onClick={() => void toGoal(b)}>{goalBusy === b.id ? k("gx.b.creating") : k("gx.b.toGoal")}</Button>}
              {game.platform === "roblox" && <Button size="sm" onClick={() => onFix(fixContext(b))}>{k("gx.b.fix")}</Button>}
              <DevTrail bug={b} world={world} commit={commit} />
              <span className="gd-push"><Button size="sm" variant="ghost" onClick={() => onDelete(b)} aria-label={k("gx.b.deleteLabel", { t: b.title })}>{k("gx.b.delete")}</Button></span>
            </div>
          </li>
        ))}
      </ul>
      {!mine.length && <Empty title={all ? k("gx.b.nothing") : k("gx.b.nothingOpen")} />}
      {note && <p role="status" className={note.ok ? "gd-note gd-ok" : "gd-error"}>{note.text}</p>}
      {paste === null ? <Button size="sm" variant="ghost" onClick={() => { setPaste(""); setNote(null); }}>{k("gx.b.import")}</Button> : (
        <div className="gd-form">
          <textarea className="gd-field gd-mono" rows={5} maxLength={50_000} aria-label={k("gx.b.pasteLabel")} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={k("gx.b.pastePh")} />
          <div className="gd-actions"><Button variant="primary" disabled={!paste.trim()} onClick={doImport}>{k("gx.b.doImport")}</Button><Button onClick={() => setPaste(null)}>{k("gx.b.cancel")}</Button></div>
        </div>
      )}
      <form className="gd-form" onSubmit={add} aria-label={k("gx.b.addLabel")}>
        <div className="gd-row3">
          <input className="gd-field gd-grow" required maxLength={140} placeholder={k("gx.b.titlePh")} aria-label={k("gx.b.titleLabel")} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <select className="gd-field" aria-label={k("gx.b.severity")} value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as Severity })}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{k(`gx.sev.${s}`)}</option>)}
          </select>
        </div>
        <div className="gd-row3">
          <select className="gd-field gd-grow" aria-label={k("gx.b.kind")} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}>{KINDS.map((x) => <option key={x} value={x}>{k(`gx.kind.${x}`)}</option>)}</select>
          <select className="gd-field gd-grow" aria-label={k("gx.b.priority")} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}>{PRIORITIES.map((p) => <option key={p} value={p}>{k(`gx.pri.${p}`)}</option>)}</select>
        </div>
        <textarea className="gd-field" rows={2} maxLength={2000} placeholder={k("gx.b.detailPh")} aria-label={k("gx.b.detailLabel")}
          value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
        <div><Button type="submit" variant="primary" disabled={!draft.title.trim() || world.bugs.length >= 500}>{k("gx.b.add")}</Button></div>
      </form>
    </Section>
  );
}

/** Health line: is the offline brain (Ollama, used when Claude is unreachable) reachable? Hidden while it's off or unknown. */
function LocalBrainLine({ paused, k }: { paused: boolean; k: K }) {
  const [st, setSt] = useState<{ state: string; text: string } | null>(null);
  useEffect(() => { if (!paused) void fetch("/api/devworld/local", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null), () => null).then(setSt, () => setSt(null)); }, [paused]);
  if (!st || st.state === "off" || !st.text) return null;
  return <p role="status" className={`gd-note${st.state === "ok" ? " gd-ok" : ""}`}>{k("gx.brain", { text: st.text })}</p>;
}
