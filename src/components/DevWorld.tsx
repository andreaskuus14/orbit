"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useGlRecovery } from "./useGlRecovery";
import { GAME_COMPONENTS } from "./GameLab";
import {
  ART_KEYS, PLATFORMS, PLAYABLE_IDS, SEVERITIES, STAGES, STATUSES, bugStats, isActive, qaPrompt, slugify, validateDevWorld,
  type Bug, type DevWorld as World, type Game, type Platform, type Severity, type Stage, type Status,
} from "@/lib/devworld-pure";

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

/** Keeps the system clear of the right-hand panel on wide screens. */
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

type Props = { flat?: boolean; onClose: () => void; reduced: boolean; onOpenTask?: (id: string) => void; onPlaying?: (p: boolean) => void };

export default function DevWorld({ onClose, reduced, onOpenTask, onPlaying, flat }: Props) {
  const glr = useGlRecovery();
  const [world, setWorld] = useState<World | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string | null; x: number; y: number }>({ id: null, x: 0, y: 0 });
  const [playing, setPlaying] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const saved = useRef<World | null>(null); // last world the server accepted: the rollback target
  const queue = useRef(Promise.resolve());
  const seq = useRef(0);
  const epoch = useRef(0);
  const base = useRef<string | null>(null); // server updatedAt this tab last saw: sent with each save to detect other tabs

  const load = useCallback(async () => {
    setLoadErr("");
    try {
      const res = await fetch("/api/devworld", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Couldn't load (${res.status})`);
      saved.current = json.world; base.current = json.updatedAt ?? null; setWorld(json.world); setSeeded(!!json.seeded);
    } catch (e) { setLoadErr(e instanceof Error ? e.message : "Couldn't load"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** Optimistic: show `next` now; PUTs run in order so the server never applies an older world after a newer one. */
  const commit = useCallback((next: World) => {
    const v = validateDevWorld(next);
    if (!v.ok) { setErr(v.error); return false; }
    setErr(""); setWorld(v.world);
    const n = ++seq.current, ep = epoch.current;
    queue.current = queue.current.then(async () => {
      if (ep !== epoch.current) return; // queued before a reload: built on a stale world
      try {
        const res = await fetch("/api/devworld", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ world: v.world, base: base.current }) });
        const json = await res.json().catch(() => ({}));
        if (res.status === 409) { epoch.current++; await load(); setErr(json.error || "Changed elsewhere — reloaded."); return; } // drop this tab's stale edit
        if (!res.ok) throw new Error(json.error || `Couldn't save (${res.status})`);
        saved.current = json.world ?? v.world; base.current = json.updatedAt ?? base.current; setSeeded(false);
        if (n === seq.current) setErr("");
      } catch (e) {
        const last = n === seq.current; // otherwise a later queued save carries this change anyway
        setErr(`${e instanceof Error ? e.message : "Couldn't save"}${last ? " — change undone." : ""}`);
        if (last && saved.current) setWorld(saved.current);
      }
    });
    return true;
  }, [load]);

  useEffect(() => { onPlaying?.(!!playing); }, [playing, onPlaying]);
  useEffect(() => () => onPlaying?.(false), [onPlaying]);
  const onHover = useCallback((id: string | null, x: number, y: number) => {
    setHover((h) => (h.id === id && Math.abs(h.x - x) < 2 && Math.abs(h.y - y) < 2 ? h : { id, x, y }));
    document.body.style.cursor = id ? "pointer" : "";
  }, []);
  useEffect(() => () => { document.body.style.cursor = ""; }, []);

  const games = useMemo(() => world?.games ?? [], [world]);
  const bugs = useMemo(() => world?.bugs ?? [], [world]);
  const game = games.find((g) => g.id === selected) ?? null;
  const hovered = games.find((g) => g.id === hover.id);
  const Game = playing ? GAME_COMPONENTS[playing] : null;
  const far = Math.max(9, orbitR(games.length) * 1.5);

  return (
    <div className="absolute inset-0 globe-in" aria-label="Game-dev world">
      {!flat && <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={playing ? "never" : "always"} camera={{ position: [0, far * 0.45, far], fov: 42 }}
        dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <color attach="background" args={["#02030a"]} />
        <Stars radius={70} depth={40} count={reduced ? 1500 : 4000} factor={2.4} fade speed={reduced ? 0 : 0.35} />
        <ambientLight intensity={0.35} />
        <ForgeStar reduced={reduced} />
        {games.map((g, i) => <OrbitPath key={`p-${g.id}`} r={orbitR(i)} />)}
        {games.map((g, i) => <Island key={g.id} game={g} i={i} selected={g.id === selected} reduced={reduced} onPick={setSelected} onHover={onHover} />)}
        <BugSwarm games={games} bugs={bugs} reduced={reduced} />
        <OrbitControls makeDefault enablePan={false} minDistance={3} maxDistance={far * 2} enableDamping dampingFactor={0.06} rotateSpeed={0.45} zoomSpeed={0.6} />
        <Rig />
        <EffectComposer multisampling={4}>
          <Bloom intensity={reduced ? 0.3 : 0.5} luminanceThreshold={0.75} luminanceSmoothing={0.3} mipmapBlur />
          <Vignette offset={0.25} darkness={0.75} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>}

      {hovered && world && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="globe-tip" style={{ transform: `translate(${hover.x + 14}px, ${hover.y + 12}px)` }}>
            {hovered.name} · {bugStats(world, hovered.id).active} open bugs
          </span>
        </div>
      )}

      <section className="glass hud-panel panel-in absolute z-[14] inset-x-3 bottom-32 max-h-[40dvh] overflow-y-auto p-3 min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:right-3 min-[900px]:top-[4.5rem] min-[900px]:w-[30rem] min-[900px]:max-h-[calc(100dvh-11rem)]"
        aria-label="Game studio">
        {!world ? (
          loadErr ? <><p className="error">{loadErr}</p><button className="chip mt-2" onClick={() => void load()}>Retry</button></> : <p className="muted">Loading studio…</p>
        ) : game ? (
          <GameDetail key={game.id} game={game} world={world} commit={commit} onBack={() => setSelected(null)} onPlay={setPlaying}
            onDeleted={() => setSelected(null)} onOpenTask={onOpenTask} />
        ) : (
          <>
            <div className="hud-title">GAME STUDIO</div>
            <p className="muted text-xs">{games.length} games · {bugs.filter(isActive).length} open bugs{seeded ? " · starter data, saved to your account on your first change" : ""}</p>
            <ul className="mt-3 space-y-1">
              {games.map((g) => {
                const s = bugStats(world, g.id);
                return (
                  <li key={g.id}>
                    <button className="hud-row" style={{ ["--accent" as string]: PLATFORM_COLOR[g.platform] }} onClick={() => setSelected(g.id)}
                      aria-label={`${g.name}, ${g.platform}, ${g.stage}, ${s.active} open bugs`}>
                      <span className="truncate">{g.name}</span><span className="muted text-xs">{g.stage}</span><span className="num">{s.active}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {!games.length && <p className="mt-3 text-sm">No games yet. Add your first one.</p>}
            {adding
              ? <GameForm taken={games.map((g) => g.id)} onCancel={() => setAdding(false)}
                  onSave={(g) => { if (commit({ ...world, games: [...games, g] })) { setAdding(false); setSelected(g.id); } }} />
              : <button className="chip mt-3" onClick={() => setAdding(true)} disabled={games.length >= 30}>+ Add game</button>}
          </>
        )}
        {err && <p className="error mt-2" role="alert">{err}</p>}
      </section>

      <button className="chip absolute z-[15] left-3 top-[4.5rem] min-[900px]:left-auto min-[900px]:top-auto min-[900px]:bottom-24 min-[900px]:right-[32rem]" onClick={onClose}>← Back to galaxy</button>
      {/* Portal: like GameLab, so no ancestor's backdrop-filter traps the full-screen game. */}
      {Game && createPortal(<Game onExit={() => setPlaying(null)} />, document.body)}
    </div>
  );
}

function Art({ game }: { game: Game }) {
  const [broken, setBroken] = useState(false);
  const c = PLATFORM_COLOR[game.platform];
  if (!game.art || broken) return <div aria-hidden className="h-32 w-full rounded-xl" style={{ background: `linear-gradient(135deg, ${c}55, #0b1226 60%, ${c}22)` }} />;
  // eslint-disable-next-line @next/next/no-img-element -- small bundled art; next/image adds nothing here
  return <img src={`/devworld/${game.art}.webp`} alt={`${game.name} art`} className="h-32 w-full rounded-xl object-cover" onError={() => setBroken(true)} />;
}

function GameDetail({ game, world, commit, onBack, onPlay, onDeleted, onOpenTask }: {
  game: Game; world: World; commit: (w: World) => boolean; onBack: () => void; onPlay: (id: string) => void; onDeleted: () => void; onOpenTask?: (id: string) => void;
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
      if (!res.ok) throw new Error(json.error || "Couldn't start the QA task");
      setQa({ busy: false, msg: "QA is on it.", ok: true });
      if (json.task?.id) onOpenTask?.(json.task.id);
    } catch (e) { setQa({ busy: false, msg: e instanceof Error ? e.message : "Couldn't start the QA task", ok: false }); }
  }

  if (editing) return <GameForm initial={game} taken={[]} onCancel={() => setEditing(false)} onSave={(g) => { if (setGame(g)) setEditing(false); }} />;
  return (
    <div className="space-y-3">
      <button className="chip" onClick={onBack}>← All games</button>
      <Art key={game.art} game={game} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: PLATFORM_COLOR[game.platform] }}>{game.name}</h2>
          <p className="muted text-xs">{game.platform} · {stats.active} open of {stats.total} bugs</p>
        </div>
        <label className="text-xs">Stage{" "}
          <select className="field py-1" value={game.stage} onChange={(e) => setGame({ ...game, stage: e.target.value as Stage })}>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      {game.pitch && <p className="text-sm">{game.pitch}</p>}
      {game.notes && <p className="muted whitespace-pre-wrap text-xs">{game.notes}</p>}
      <div className="flex flex-wrap gap-2">
        {game.playable && GAME_COMPONENTS[game.playable] && <button className="btn" onClick={() => onPlay(game.playable!)} aria-label={`Play ${game.name}`}>▶ Play</button>}
        <button className="btn" onClick={() => void playtest()} disabled={qa.busy}>{qa.busy ? "Starting…" : "Playtest with QA"}</button>
        <button className="chip" onClick={() => setEditing(true)}>Edit game</button>
        <button className="chip" onClick={() => {
          if (!confirm(`Delete ${game.name} and its ${stats.total} bugs?`)) return;
          if (commit({ ...world, games: world.games.filter((g) => g.id !== game.id), bugs: world.bugs.filter((b) => b.game !== game.id) })) onDeleted();
        }}>Delete game</button>
      </div>
      {qa.msg && <p role="status" className={qa.ok ? "ok" : "error"}>{qa.msg}</p>}
      <BugTracker game={game} world={world} commit={commit} />
    </div>
  );
}

function GameForm({ initial, taken, onSave, onCancel }: { initial?: Game; taken: string[]; onSave: (g: Game) => void; onCancel: () => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? "", platform: initial?.platform ?? ("roblox" as Platform), stage: initial?.stage ?? ("idea" as Stage),
    pitch: initial?.pitch ?? "", notes: initial?.notes ?? "", art: initial?.art ?? "", playable: initial?.playable ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="mt-3 space-y-2" aria-label={initial ? "Edit game" : "Add game"} onSubmit={(e) => {
      e.preventDefault();
      if (!f.name.trim()) return;
      const g: Game = { id: initial?.id ?? slugify(f.name, taken), name: f.name, platform: f.platform, stage: f.stage, pitch: f.pitch, notes: f.notes };
      if (f.art) g.art = f.art as Game["art"];
      if (f.playable) g.playable = f.playable as Game["playable"];
      onSave(g);
    }}>
      <label className="block text-xs">Name<input className="field mt-1 w-full" required maxLength={60} value={f.name} onChange={set("name")} /></label>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs">Platform <select className="field py-1" value={f.platform} onChange={set("platform")}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label className="text-xs">Stage <select className="field py-1" value={f.stage} onChange={set("stage")}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="text-xs">Art <select className="field py-1" value={f.art} onChange={set("art")}><option value="">none</option>{ART_KEYS.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="text-xs">Playable <select className="field py-1" value={f.playable} onChange={set("playable")}><option value="">no</option>{PLAYABLE_IDS.map((p) => <option key={p}>{p}</option>)}</select></label>
      </div>
      <label className="block text-xs">Pitch<textarea className="field mt-1 w-full" rows={2} maxLength={300} value={f.pitch} onChange={set("pitch")} /></label>
      <label className="block text-xs">Notes<textarea className="field mt-1 w-full" rows={4} maxLength={4000} value={f.notes} onChange={set("notes")} /></label>
      <div className="flex gap-2"><button className="btn">{initial ? "Save game" : "Add game"}</button><button type="button" className="chip" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function BugTracker({ game, world, commit }: { game: Game; world: World; commit: (w: World) => boolean }) {
  const [all, setAll] = useState(false);
  const [draft, setDraft] = useState({ title: "", severity: "major" as Severity, detail: "" });
  const mine = world.bugs.filter((b) => b.game === game.id && (all || isActive(b)));
  const setBug = (id: string, patch: Partial<Bug>) => commit({ ...world, bugs: world.bugs.map((b) => (b.id === id ? { ...b, ...patch } : b)) });

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const bug: Bug = { id: crypto.randomUUID(), game: game.id, title: draft.title, detail: draft.detail, severity: draft.severity, status: "open", created: new Date().toISOString() };
    if (commit({ ...world, bugs: [...world.bugs, bug] })) setDraft({ title: "", severity: draft.severity, detail: "" });
  }

  return (
    <section aria-label={`Bugs for ${game.name}`} className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="hud-title">BUGS</div>
        <div className="flex gap-1" role="group" aria-label="Bug filter">
          <button className="chip" aria-pressed={!all} onClick={() => setAll(false)}>Open</button>
          <button className="chip" aria-pressed={all} onClick={() => setAll(true)}>All</button>
        </div>
      </div>
      <ul className="space-y-2">
        {mine.map((b) => (
          <li key={b.id} className="card space-y-1" style={{ boxShadow: `inset 3px 0 0 ${SEVERITY_COLOR[b.severity]}` }}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm">{b.title}</p>
              <span className="shrink-0 text-xs" style={{ color: SEVERITY_COLOR[b.severity] }}>{b.severity}</span>
            </div>
            {b.detail && <p className="muted whitespace-pre-wrap text-xs">{b.detail}</p>}
            <div className="flex items-center gap-2 text-xs">
              <select className="field py-1" aria-label={`Status of ${b.title}`} value={b.status}
                onChange={(e) => { const status = e.target.value as Status; setBug(b.id, { status, fixed: status === "fixed" ? new Date().toISOString() : undefined }); }}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <span className="muted">{b.fixed ? `fixed ${new Date(b.fixed).toLocaleDateString()}` : `logged ${new Date(b.created).toLocaleDateString()}`}</span>
              <button className="chip ml-auto" aria-label={`Delete bug ${b.title}`}
                onClick={() => { if (confirm(`Delete bug "${b.title}"?`)) commit({ ...world, bugs: world.bugs.filter((x) => x.id !== b.id) }); }}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
      {!mine.length && <p className="muted text-sm">{all ? "No bugs logged." : "No open bugs. Nice."}</p>}
      <form className="space-y-2" onSubmit={add} aria-label="Add bug">
        <div className="flex gap-2">
          <input className="field min-w-0 flex-1" required maxLength={140} placeholder="New bug title" aria-label="Bug title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <select className="field py-1" aria-label="Severity" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as Severity })}>
            {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <textarea className="field w-full" rows={2} maxLength={2000} placeholder="Steps to reproduce, what you expected (optional)" aria-label="Bug detail"
          value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
        <button className="btn" disabled={!draft.title.trim() || world.bugs.length >= 500}>Add bug</button>
      </form>
    </section>
  );
}
