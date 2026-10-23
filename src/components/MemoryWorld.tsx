"use client";
// MEMORY world: every memory is a star. Positions come from /api/memories/map (server-side layout from embeddings),
// links are faint threads, CORE-learned memories carry a ring. The list drawer lives on as "List view" in the side panel.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type RootState, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls, Stars, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { useGlRecovery } from "./useGlRecovery";
import { MemoryPanel } from "./panels";
import { beliefsPending } from "./BeliefsPanel";
import type { QualityMode } from "@/lib/quality-pure";
import { useLeanQuality } from "./useLeanQuality";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { centroid, isLearned, searchStars } from "@/lib/memory-world-pure";
import { DAY, edgeBorn, edgeGlow } from "@/lib/memory-edges-pure";

type Star = { id: string; title: string; kind: string; tags: string[]; created_at: string; source: string | null; x: number; y: number; z: number };
type MapData = { items: Star[]; links: { from: string; to: string }[]; edges?: [number, number, number][]; total: number };

const BG = "#020308";
const KIND_COLOR: Record<string, string> = {
  note: "#9ec9ff", idea: "#ffd27a", link: "#7de3d0", document: "#c3b4ff", image: "#ff9ec7", research: "#7dc4ff",
  conversation: "#b8f0a8", project: "#ffb27a", preference: "#f0a8ff", decision: "#ff8f8f", goal: "#fff3a8",
};
const kindColor = (k: string) => KIND_COLOR[k] ?? "#a9b4c8";
const WEB = new THREE.Color("#a5b4fc"); // similarity web
const REPLAY_TICKS = 120, REPLAY_MS = 80, REPLAY_TICKS_REDUCED = 8, REPLAY_MS_REDUCED = 700; // ~10 s replay; reduced motion jumps in a few steps

const vert = /* glsl */ `
  attribute vec3 aColor; attribute float aGlow; attribute float aHi; attribute float aBorn;
  uniform float uTime; uniform float uScale; uniform float uMotion; uniform float uAt;
  varying vec3 vColor; varying float vGlow; varying float vHi;
  void main() {
    if (aBorn > uAt) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // not yet saved at the replayed moment
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(-mv.z, 0.5);
    float tw = 1.0 + uMotion * 0.12 * sin(uTime * 1.3 + position.x * 3.1 + position.y * 1.7);
    gl_PointSize = clamp(0.32 * (1.0 + aGlow * 0.25 + aHi * 1.1) * tw * uScale / d, 1.5, 72.0);
    gl_Position = projectionMatrix * mv;
    vColor = aColor; vGlow = aGlow; vHi = aHi;
  }`;
const frag = /* glsl */ `
  uniform float uSearch;
  varying vec3 vColor; varying float vGlow; varying float vHi;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 14.0), halo = exp(-r2 * 3.5) * 0.3;
    float ring = vGlow * smoothstep(0.1, 0.0, abs(sqrt(r2) - 0.7)) * 0.55; // CORE-learned: a thin orbit ring
    float dim = mix(1.0, 0.18, uSearch * (1.0 - vHi));
    vec3 c = vColor * (core * 1.3 + halo + ring) + vec3(core * (0.5 + vHi * 0.6));
    gl_FragColor = vec4(clamp(c, 0.0, 4.0) * dim, 1.0);
  }`;

function Constellation({ data, at, hi, searching, reduced, onHover, onPick }: {
  data: MapData; at: number | null; hi: Set<number>; searching: boolean; reduced: boolean; onHover: (i: number | null) => void; onPick: (i: number) => void;
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
  const web = useMemo(() => { // the similarity web: one LineSegments, colours repainted only when the moment changes
    const e = data.edges ?? [], pos = new Float32Array(e.length * 6), born = new Float64Array(e.length);
    e.forEach(([a, b], k) => {
      const p = data.items[a], q = data.items[b];
      if (!p || !q) { born[k] = Infinity; return; }
      pos.set([p.x, p.y, p.z, q.x, q.y, q.z], k * 6);
      born[k] = edgeBorn(times.at[a], times.at[b]);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(e.length * 6), 3));
    return { g, born, sim: e.map((x) => x[2]) };
  }, [data, times]);
  const now = at ?? times.now;
  useEffect(() => {
    const a = web.g.getAttribute("color") as THREE.BufferAttribute, arr = a.array as Float32Array;
    for (let k = 0; k < web.born.length; k++) {
      const v = edgeGlow(web.born[k], now, web.sim[k]);
      for (let j = 0; j < 6; j += 3) { arr[k * 6 + j] = WEB.r * v; arr[k * 6 + j + 1] = WEB.g * v; arr[k * 6 + j + 2] = WEB.b * v; }
    }
    a.needsUpdate = true;
  }, [web, now]);
  useEffect(() => () => { geo.dispose(); lines.dispose(); web.g.dispose(); }, [geo, lines, web]);
  const shown = (i: number) => times.at[i] <= now;
  useEffect(() => {
    const a = geo.getAttribute("aHi") as THREE.BufferAttribute;
    (a.array as Float32Array).fill(0);
    hi.forEach((i) => { a.array[i] = 1; });
    a.needsUpdate = true;
  }, [geo, hi]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uScale: { value: 400 }, uMotion: { value: 0 }, uSearch: { value: 0 }, uAt: { value: 1e9 } }), []);
  useFrame(({ clock }) => {
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    uniforms.uTime.value = clock.elapsedTime % 1000; // bounded: keeps sin() precise
    uniforms.uScale.value = (size.height * gl.getPixelRatio()) / (2 * Math.tan((fov * Math.PI) / 360));
    uniforms.uMotion.value = reduced ? 0 : 1;
    uniforms.uSearch.value = searching ? 1 : 0;
    uniforms.uAt.value = at === null ? 1e9 : (at - times.t0) / DAY;
  });
  return <>
    <lineSegments geometry={web.g} raycast={() => null}>
      <lineBasicMaterial vertexColors transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} />
    </lineSegments>
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
  useFrame((_, dt) => {
    if (!goal || !controls || !active.current) return;
    to.set(...goal.at);
    dir.copy(camera.position).sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    want.copy(to).add(dir.normalize().multiplyScalar(goal.dist));
    const k = reduced ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 3);
    controls.target.lerp(to, k);
    camera.position.lerp(want, k);
    controls.update();
    if (controls.target.distanceTo(to) < 0.01 && camera.position.distanceTo(want) < 0.02) active.current = false; // let the user orbit again
  });
  return null;
}

export default function MemoryWorld({ onClose, reduced, flat, quality = "auto", focusId, onChanged, paused = false }: {
  onClose: () => void; reduced: boolean; flat?: boolean; quality?: QualityMode; focusId: string | null; onChanged: () => void; paused?: boolean /* kept mounted but hidden */;
}) {
  const glr = useGlRecovery();
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
      {!flat && (
        <Canvas key={glr.key} onCreated={onCreated} frameloop={paused ? "never" : "always"} camera={{ position: [0, 6, 46], fov: 50, near: 0.1, far: 400 }} dpr={[1, q.dpr]} gl={{ antialias: false }}
          onPointerMissed={() => setSel(null)} style={{ cursor: hover !== null ? "pointer" : undefined }}>
          {quality === "auto" && <PerformanceMonitor onDecline={q.onDecline} />}
          <color attach="background" args={[BG]} />
          <Stars radius={120} depth={60} count={reduced ? 800 : Math.min(3000, q.stars)} factor={2.2} fade speed={reduced ? 0 : 0.2} />
          {data && <Constellation data={data} at={when} hi={hi} searching={!!query.trim()} reduced={reduced} onHover={setHover} onPick={open} />}
          {label && (
            <Html position={[label.x, label.y, label.z]} style={{ pointerEvents: "none", transform: "translate(14px, -50%)" }} zIndexRange={[12, 0]}>
              <div className="memory-star-label"><b>{label.title}</b><span>{label.kind}{isLearned(label.source) ? " · learned by CORE" : ""}</span></div>
            </Html>
          )}
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={3} maxDistance={110} autoRotate={!reduced && hover === null} autoRotateSpeed={0.18} />
          <Fly goal={goal} reduced={reduced} />
          {q.bloomScale > 0 && (
            <EffectComposer multisampling={q.msaa}>
              <Bloom intensity={(reduced ? 0.4 : 0.75) * q.bloomScale} luminanceThreshold={0.35} luminanceSmoothing={0.4} mipmapBlur />
              <Vignette offset={0.3} darkness={0.75} />
            </EffectComposer>
          )}
        </Canvas>
      )}

      <section className="glass hud-panel world-panel panel-in absolute inset-x-3 bottom-32 z-[14] flex max-h-[45dvh] flex-col gap-3 overflow-y-auto p-3 text-sm min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:right-3 min-[900px]:top-[4.5rem] min-[900px]:max-h-[calc(100dvh-11rem)] min-[900px]:w-[30rem]" aria-label="MEMORY controls">
        <div className="flex items-center justify-between gap-2">
          <h2 className="brand text-base">MEMORY <span className="muted num text-xs font-normal">{data ? `${data.items.length}${data.total > data.items.length ? ` of ${data.total}` : ""} stars` : ""}</span></h2>
          {!flat && <div className="flex gap-1.5">
            <button className="chip" aria-pressed={!list} onClick={() => setList(false)}>Constellation</button>
            <button className="chip" aria-pressed={list} onClick={() => setList(true)}>List view</button>
          </div>}
        </div>

        {list || flat ? <MemoryPanel focusId={focusId} onChanged={onChanged} /> : <>
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
