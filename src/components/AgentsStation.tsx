"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useGlRecovery } from "./useGlRecovery";
import { ZoomRig } from "./ZoomRig";
import { AgentsPanel, type Task } from "./AgentsPanels";
import { QUALITY, type QualityMode } from "@/lib/quality-pure";
import { STATUS_LABEL, activityFeed, agentStatus, clamp, currentTask, statusGlow, type AgentStatus } from "@/lib/station-pure";

// AGENTS → a space station: each agent is a drone module orbiting the hub, glowing by status.
// Data: /api/agents (roster + running counts incl. sub-tasks), /api/tasks (top-level tasks), /api/tasks/:id (live trace).
// Built-in materials only and every emissive/opacity value goes through clamp(), so Bloom never sees NaN/negative output.

type Agent = { slug: string; name: string; role: string; color: string; builtin: boolean; stats: { running: number } };
type Detail = { task: Task; children: Task[] };

const HOME = 11;
const STATUS_DOT: Record<AgentStatus, string> = { idle: "var(--muted)", working: "var(--cyan)", waiting: "#fbbf24", failed: "#fb7185" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const ago = (iso: number) => { const s = Math.max(0, (Date.now() - iso) / 1000); return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

/** Where module i of n is at time t: two counter-rotating rings around the hub. */
function modulePos(i: number, n: number, t: number, out: THREE.Vector3) {
  const outer = i % 2, r = 3 + outer * 1.1;
  const a = (i / Math.max(1, n)) * Math.PI * 2 + t * (outer ? -0.12 : 0.18);
  return out.set(Math.cos(a) * r, Math.sin(t * 0.8 + i) * 0.18 + (outer ? 0.35 : -0.2), Math.sin(a) * r);
}

/** Visible-tab polling: runs fn now and every ms while enabled. */
function usePoll(fn: () => void, ms: number, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    fn();
    const h = setInterval(fn, ms);
    return () => clearInterval(h);
  }, [fn, ms, enabled]);
}

/* ---------- scene ---------- */

function Hub({ reduced }: { reduced: boolean }) {
  const rings = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (rings.current && !reduced) rings.current.rotation.y += dt * 0.15; });
  return (
    <group>
      <mesh><sphereGeometry args={[0.55, 40, 40]} /><meshBasicMaterial color={[1.6, 1.2, 2]} toneMapped={false} /></mesh>
      <mesh><sphereGeometry args={[0.8, 32, 32]} /><meshStandardMaterial color="#334155" metalness={0.8} roughness={0.35} transparent opacity={0.45} /></mesh>
      <group ref={rings}>
        <mesh rotation-x={Math.PI / 2}><torusGeometry args={[1.4, 0.06, 12, 96]} /><meshStandardMaterial color="#94a3b8" metalness={0.7} roughness={0.4} /></mesh>
        {[0, 1, 2, 3].map((k) => (
          <group key={k} rotation-y={(k * Math.PI) / 2}>
            <mesh position={[0.95, 0, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.03, 0.03, 0.9, 8]} /><meshStandardMaterial color="#64748b" metalness={0.6} /></mesh>
          </group>
        ))}
      </group>
      {[3, 4.1].map((r) => (
        <mesh key={r} rotation-x={-Math.PI / 2}><ringGeometry args={[r - 0.006, r + 0.006, 128]} /><meshBasicMaterial color="#a78bfa" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      ))}
      <pointLight intensity={2} decay={0} color="#ddd6fe" />
    </group>
  );
}

function Module({ agent, i, n, status, selected, reduced, onPick, onHover }: {
  agent: Agent; i: number; n: number; status: AgentStatus; selected: boolean; reduced: boolean;
  onPick: (slug: string) => void; onHover: (slug: string | null, x: number, y: number) => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const body = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const t = reduced ? 0 : clock.elapsedTime;
    if (ref.current) { modulePos(i, n, t, ref.current.position); ref.current.rotation.y = t * 0.6; }
    const g = statusGlow(status, agent.color, clock.elapsedTime, reduced);
    if (body.current) { body.current.emissive.set(g.color); body.current.emissiveIntensity = clamp(g.intensity, 0, 2.5); }
    if (halo.current) { halo.current.color.set(g.color); halo.current.opacity = clamp(g.intensity * 0.18, 0, 0.45); }
  });
  return (
    <group ref={ref}>
      <mesh
        onClick={(e) => { e.stopPropagation(); if (e.delta <= 5) onPick(agent.slug); }}
        onPointerMove={(e) => { e.stopPropagation(); onHover(agent.slug, e.nativeEvent.clientX, e.nativeEvent.clientY); }}
        onPointerOut={(e) => onHover(null, e.nativeEvent.clientX, e.nativeEvent.clientY)}>
        <octahedronGeometry args={[0.26, 0]} />
        <meshStandardMaterial ref={body} color={agent.color} emissive={agent.color} emissiveIntensity={0.12} flatShading metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh rotation-x={Math.PI / 2}><torusGeometry args={[0.38, 0.015, 6, 32]} /><meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.3} /></mesh>
      <mesh><sphereGeometry args={[0.5, 16, 16]} /><meshBasicMaterial ref={halo} transparent opacity={0} depthWrite={false} /></mesh>
      {selected && <mesh rotation-x={Math.PI / 2}><torusGeometry args={[0.62, 0.012, 8, 64]} /><meshBasicMaterial color="#e9d5ff" /></mesh>}
    </group>
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
    const p = index >= 0 ? modulePos(index, n, reduced ? 0 : clock.elapsedTime, tmp.p) : tmp.p.set(0, 0, 0);
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

type Props = { flat?: boolean; onClose: () => void; reduced: boolean; quality?: QualityMode; onOpenTask?: (id: string) => void };

export default function AgentsStation({ flat, onClose, reduced, quality = "auto", onOpenTask }: Props) {
  const glr = useGlRecovery();
  const [visible, setVisible] = useState(true);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
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

  const onHover = useCallback((id: string | null, x: number, y: number) => {
    setHover((h) => (h.id === id && Math.abs(h.x - x) < 2 && Math.abs(h.y - y) < 2 ? h : { id, x, y }));
    document.body.style.cursor = id ? "pointer" : "";
  }, []);
  useEffect(() => () => { document.body.style.cursor = ""; }, []);

  const list = useMemo(() => agents ?? [], [agents]);
  const status = useMemo(() => Object.fromEntries(list.map((a) => [a.slug, agentStatus(tasks, a.slug, a.stats.running)])) as Record<string, AgentStatus>, [list, tasks]);
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
        <ambientLight intensity={0.4} />
        <Hub reduced={reduced} />
        {list.map((a, i) => <Module key={a.slug} agent={a} i={i} n={list.length} status={status[a.slug]} selected={a.slug === selected} reduced={reduced} onPick={setSelected} onHover={onHover} />)}
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
      </Canvas>}

      {hovered && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="globe-tip" style={{ transform: `translate(${hover.x + 14}px, ${hover.y + 12}px)` }}>
            {hovered.name} · {currentTask(tasks, hovered.slug)?.title.slice(0, 60) ?? STATUS_LABEL[status[hovered.slug]]}
          </span>
        </div>
      )}

      <section className="glass hud-panel panel-in absolute z-[14] inset-x-3 bottom-32 max-h-[40dvh] overflow-y-auto p-3 min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:right-3 min-[900px]:top-[4.5rem] min-[900px]:w-[30rem] min-[900px]:max-h-[calc(100dvh-11rem)]"
        aria-label="Agents station">
        {!agents ? (
          err ? <><p className="error">{err}</p><button className="chip mt-2" onClick={loadAgents}>Retry</button></> : <p className="muted">Docking…</p>
        ) : agent ? (
          <AgentDetail key={agent.slug} agent={agent} status={status[agent.slug]} tasks={tasks} visible={visible} onBack={() => setSelected(null)} onChanged={loadTasks} onOpenTask={onOpenTask} />
        ) : manage ? (
          <><button className="chip mb-3" onClick={() => { setManage(false); loadAgents(); }}>← Station</button><AgentsPanel onOpenTask={(id) => onOpenTask?.(id)} /></>
        ) : (
          <>
            <div className="hud-title">AGENTS STATION</div>
            <p className="muted text-xs">{list.length} agents · {list.filter((a) => status[a.slug] === "working").length} working · {list.filter((a) => status[a.slug] === "waiting").length} need approval</p>
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
          </>
        )}
        {err && agents && <p className="error mt-2" role="alert">{err}</p>}
      </section>

      <div role="log" aria-label="Agent activity" aria-relevant="additions" className="glass absolute z-[14] inset-x-3 bottom-[6.25rem] flex gap-4 overflow-x-auto whitespace-nowrap rounded-full px-4 py-1.5 text-xs min-[900px]:right-[32rem]">
        <span className="hud-title shrink-0 text-[0.7rem]">ACTIVITY</span>
        {feed.map((e) => (
          <span key={e.key} className="shrink-0">
            <b>{names[e.agent] ?? e.agent}</b> <span className="muted">{e.text.length > 70 ? `${e.text.slice(0, 70)}…”` : e.text}</span> <span className="muted" aria-hidden>· {ago(e.at)}</span>
          </span>
        ))}
        {!feed.length && <span className="muted">No agent activity yet. Give an agent a job.</span>}
      </div>

      <button className="chip absolute z-[15] left-3 top-[4.5rem] min-[900px]:left-auto min-[900px]:top-auto min-[900px]:bottom-[8.5rem] min-[900px]:right-[32rem]" onClick={onClose}>← Back to galaxy</button>
    </div>
  );
}

function AgentDetail({ agent, status, tasks, visible, onBack, onChanged, onOpenTask }: {
  agent: Agent; status: AgentStatus; tasks: Task[]; visible: boolean; onBack: () => void; onChanged: () => void; onOpenTask?: (id: string) => void;
}) {
  const [job, setJob] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const mine = tasks.filter((t) => t.agent === agent.slug);
  const cur = currentTask(mine, agent.slug);
  const curId = cur?.id ?? null;

  const load = useCallback(() => {
    if (!curId) { setDetail(null); return; }
    api<Detail>(`/api/tasks/${curId}`).then((r) => { setDetail(r); setErr(""); }).catch((e) => setErr(e.message));
  }, [curId]);
  usePoll(load, 3_000, visible);

  async function act(action: "approve" | "reject" | "cancel", id: string) {
    setErr(""); setBusy(true);
    try { await api(`/api/tasks/${id}`, { method: "POST", body: JSON.stringify({ action }) }); load(); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  async function give(e: React.FormEvent) {
    e.preventDefault();
    if (!job.trim()) return;
    setErr(""); setBusy(true);
    try { await api("/api/tasks", { method: "POST", body: JSON.stringify({ request: job, agent: agent.slug }) }); setJob(""); onChanged(); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not create the task"); }
    finally { setBusy(false); }
  }

  const d = detail && detail.task.id === curId ? detail : null;
  // Approve the task that actually holds the pending actions: a parent waiting on a delegated sub-task has none itself.
  const holder = d ? [d.task, ...d.children].find((t) => t.pending.some((p) => p.status === "pending")) : undefined;
  const steps = d ? [...d.task.trace.map((s) => ({ ...s, who: d.task.agent })), ...d.children.flatMap((c) => c.trace.map((s) => ({ ...s, who: c.agent })))] : [];

  return (
    <div className="space-y-3">
      <button className="chip" onClick={onBack}>← All agents</button>
      <div>
        <h2 ref={title} tabIndex={-1} className="text-lg font-semibold outline-none" style={{ color: agent.color }}>{agent.name}</h2>
        <p className="muted text-xs">{agent.role}</p>
        <p className="text-xs" style={{ color: STATUS_DOT[status] }}>● {STATUS_LABEL[status]}</p>
      </div>

      <form onSubmit={give} className="flex gap-2">
        <input className="field min-w-0 flex-1" value={job} onChange={(e) => setJob(e.target.value)} placeholder={`Give ${agent.name} a job`} aria-label={`Job for ${agent.name}`} maxLength={8000} />
        <button className="btn" disabled={busy || !job.trim()}>Start</button>
      </form>

      {cur ? (
        <section className="card space-y-2" aria-label="Current task">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium">{cur.title}</p>
            <span className="shrink-0 text-xs muted">{cur.status.replace("_", " ")}</span>
          </div>
          {holder && (
            <div className="space-y-1 text-xs" style={{ color: "#fbbf24" }}>
              {holder.pending.filter((p) => p.status === "pending").map((p, i) => <p key={i}><b>{p.tool.replace(/_/g, " ")}</b>: {String(p.input.title ?? p.input.name ?? "")}</p>)}
              <div className="flex gap-2">
                <button className="btn" disabled={busy} onClick={() => void act("approve", holder.id)}>Approve</button>
                <button className="btn danger" disabled={busy} onClick={() => void act("reject", holder.id)}>Reject</button>
              </div>
            </div>
          )}
          {(cur.status === "queued" || cur.status === "running") && <button className="chip" disabled={busy} onClick={() => void act("cancel", cur.id)}>Cancel task</button>}
          {!holder && d && cur.status === "awaiting_approval" && onOpenTask && (
            <button className="link text-xs" style={{ color: "#fbbf24" }} onClick={() => onOpenTask(cur.id)}>Waiting on a nested sub-task: open full task to approve →</button>
          )}
          {cur.error && <p className="error text-xs">{cur.error}</p>}
          <ol className="max-h-56 space-y-0.5 overflow-y-auto text-xs" aria-label="Trace">
            {steps.map((s, n) => <li key={n}>{s.ok ? "✓" : "✗"} <b>{s.who !== agent.slug ? `${s.who} · ` : ""}{s.step}</b> <span className="muted">{s.detail}</span></li>)}
            {!steps.length && <li className="muted">{d ? "No steps yet." : "Loading trace…"}</li>}
          </ol>
          {onOpenTask && <button className="link text-xs" onClick={() => onOpenTask(cur.id)}>Open full task →</button>}
        </section>
      ) : <p className="muted text-sm">No tasks yet.</p>}

      {mine.length > 1 && (
        <section aria-label="Recent tasks">
          <div className="hud-title">RECENT</div>
          <ul className="mt-1 space-y-1 text-xs">
            {mine.filter((t) => t.id !== curId).slice(0, 6).map((t) => (
              <li key={t.id}><button className="text-left" onClick={() => onOpenTask?.(t.id)}>{t.title} <span className="muted">· {t.status.replace("_", " ")}</span></button></li>
            ))}
          </ul>
        </section>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
