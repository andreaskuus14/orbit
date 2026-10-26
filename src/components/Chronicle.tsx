"use client";
// MEMORY → Chronicle: his life and work as a calm river of time flowing into the distance. Days are thin glowing rings
// (one instanced quad, one program), moments are points in their planet's colour around the ring (one points program, shared
// with the river's flowing dust); big moments burn as beacons. Scrub with the wheel, drag or the slider; Play flies a week or a
// month with captions (and CORE's voice when he turns it on). Data: /api/chronicle (chronicle-pure.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type RootState, type ThreeEvent } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useGlRecovery } from "./useGlRecovery";
import { useLeanQuality } from "./useLeanQuality";
import { useMountLater, WarmCompile, WarmIn } from "./WarmCompile";
import { speakChunk, speechSettings, stop as stopSpeech } from "./voice/speak";
import { smoothDamp } from "@/lib/smooth-damp-pure";
import type { QualityMode } from "@/lib/quality-pure";
import { PLANETS, planetById } from "@/lib/planets";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { OPEN_SOURCE_EVENT } from "@/lib/week-pure";
import { BIG, dayIndex, dayLastYear, narrate, type Chronicle as Chron, type Link, type Moment } from "@/lib/chronicle-pure";

type Data = Chron & { untitled?: string[] };
const BG = "#020308", DZ = 1.6, R = 3, AHEAD = 140, BEHIND = 4; // world units per day; rings drawn this many days around the head
const LANES = [...PLANETS.map((p) => p.id), "core"];
const colorOf = (planet: string) => planetById(planet)?.color ?? "#e2e8f0";
const PRIV_KEY = "orbit.chronicle.private";
const readPriv = () => { try { return localStorage.getItem(PRIV_KEY) === "1"; } catch { return false; } };
const SPEED = { week: 0.55, month: 1.2 } as const; // days per second while playing (a week ≈ 13 s, a month ≈ 25 s)

const FADE = /* glsl */ `uniform float uHead;
  float along(float day) { float d = day - uHead; return d < -${BEHIND}.0 || d > ${AHEAD}.0 ? 0.0 : smoothstep(-${BEHIND}.0, 0.0, d) * exp(-max(d, 0.0) / 45.0); }`;
const ringVert = /* glsl */ `
  attribute float aDay; attribute float aGlow; attribute float aMark; varying vec2 vP; varying float vA; varying float vGlow; varying float vMark;
  ${FADE}
  void main() {
    vA = along(aDay); vGlow = aGlow; vMark = aMark; vP = position.xy;
    if (vA <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy * ${(R * 1.15).toFixed(2)}, -aDay * ${DZ.toFixed(2)}, 1.0);
  }`;
const ringFrag = /* glsl */ `
  varying vec2 vP; varying float vA; varying float vGlow; varying float vMark;
  void main() {
    float r = length(vP), w = 0.006 + vMark * 0.006, d = abs(r - 0.87);
    if (d > 0.08) discard;
    float line = exp(-d * d / (w * w)), halo = exp(-d * 26.0) * (0.12 + vGlow * 0.5);
    vec3 c = mix(vec3(0.35, 0.55, 0.9), vec3(0.75, 0.9, 1.0), vGlow) * (line * (0.35 + vGlow * 0.9 + vMark * 0.4) + halo);
    gl_FragColor = vec4(c * vA, 1.0);
  }`;
// Moments and the river's dust share one program: aFlow 1 = dust that drifts with the current around the head.
const ptVert = /* glsl */ `
  attribute vec3 aColor; attribute float aSize; attribute float aDay; attribute float aIdx; attribute float aFlow;
  uniform float uTime; uniform float uScale; uniform float uSel;
  varying vec3 vColor; varying float vBig; varying float vSel;
  ${FADE}
  void main() {
    vec3 p = position; float a;
    if (aFlow > 0.0) { // dust: lives in head-relative space, loops along the river
      float z = mod(position.z + uTime * 0.9, ${(AHEAD * DZ * 0.5).toFixed(1)});
      p.z = -uHead * ${DZ.toFixed(2)} + 6.0 - z; a = smoothstep(0.0, 6.0, z) * exp(-z / 60.0) * 0.5;
    } else a = along(aDay);
    if (a <= 0.0) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vSel = step(abs(aIdx - uSel), 0.5); vBig = step(${BIG.toFixed(2)}, aSize);
    float px = (0.05 + aSize * 0.16 + vSel * 0.12) * uScale / max(-mv.z, 0.5);
    float k = clamp(px / 2.5, 0.0, 1.0); // sub-pixel points fade instead of shimmering
    gl_PointSize = clamp(px, 2.5, 120.0);
    gl_Position = projectionMatrix * mv;
    vColor = aColor * a * k * k;
  }`;
const ptFrag = /* glsl */ `
  varying vec3 vColor; varying float vBig; varying float vSel;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 14.0), halo = exp(-r2 * 3.5) * 0.35;
    float flare = vBig * (exp(-abs(p.x) * 30.0) + exp(-abs(p.y) * 30.0)) * exp(-r2 * 2.0) * 0.6; // beacons: a four-point glint
    float ring = vSel * smoothstep(0.08, 0.0, abs(sqrt(r2) - 0.75));
    gl_FragColor = vec4(clamp(vColor * (core * (1.0 + vBig) + halo + flare) + vec3(core * 0.25 + ring) * length(vColor), 0.0, 2.0), 1.0);
  }`;

/** A moment's place: its planet's lane around the ring, inner for small moments, at its hour within the day. */
function place(m: Moment, d: number, k: number): [number, number, number] {
  const lane = Math.max(0, LANES.indexOf(m.planet)), ang = (lane / LANES.length) * Math.PI * 2 + 0.3 + ((k % 3) - 1) * 0.07;
  const r = R * (0.35 + 0.5 * m.score), hour = ((m.at - Date.parse(`${m.day}T00:00:00Z`)) / 86_400_000 + 1) % 1;
  return [Math.cos(ang) * r, Math.sin(ang) * r * 0.8, -(d + hour * 0.9) * DZ];
}

function River({ data, headRef, sel, reduced, dust, onPick, dragged }: {
  data: Data; headRef: React.RefObject<number>; sel: number | null; reduced: boolean; dust: number; onPick: (i: number) => void; dragged: React.RefObject<boolean>;
}) {
  const { camera, size, gl } = useThree();
  const uniforms = useMemo(() => ({ uHead: { value: headRef.current }, uTime: { value: 0 }, uScale: { value: 400 }, uSel: { value: -1 } }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const mats = useMemo(() => {
    const add = { uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    return { ring: new THREE.ShaderMaterial({ ...add, vertexShader: ringVert, fragmentShader: ringFrag }), pt: new THREE.ShaderMaterial({ ...add, vertexShader: ptVert, fragmentShader: ptFrag }) };
  }, [uniforms]);
  const rings = useMemo(() => {
    const plane = new THREE.PlaneGeometry(2, 2), g = new THREE.InstancedBufferGeometry().copy(plane as unknown as THREE.InstancedBufferGeometry);
    plane.dispose();
    const n = data.days.length, day = new Float32Array(n), glow = new Float32Array(n), mark = new Float32Array(n);
    data.days.forEach((d, i) => { day[i] = i; glow[i] = d.score; mark[i] = d.day.endsWith("-01") ? 1 : new Date(`${d.day}T12:00:00Z`).getUTCDay() === 1 ? 0.5 : 0; });
    g.setAttribute("aDay", new THREE.InstancedBufferAttribute(day, 1));
    g.setAttribute("aGlow", new THREE.InstancedBufferAttribute(glow, 1));
    g.setAttribute("aMark", new THREE.InstancedBufferAttribute(mark, 1));
    g.instanceCount = n;
    return g;
  }, [data]);
  const pts = useMemo(() => {
    const n = data.moments.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n), dy = new Float32Array(n), idx = new Float32Array(n), c = new THREE.Color();
    const seen = new Map<string, number>();
    data.moments.forEach((m, i) => {
      const d = dayIndex(data.from, m.day), k = seen.get(m.day + m.planet) ?? 0;
      seen.set(m.day + m.planet, k + 1);
      pos.set(place(m, d, k), i * 3);
      c.set(colorOf(m.planet)).multiplyScalar(m.private ? 0.5 : 0.6 + m.score * 0.9); col.set([c.r, c.g, c.b], i * 3);
      sz[i] = m.score; dy[i] = d; idx[i] = i;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sz, 1));
    g.setAttribute("aDay", new THREE.BufferAttribute(dy, 1));
    g.setAttribute("aIdx", new THREE.BufferAttribute(idx, 1));
    g.setAttribute("aFlow", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.computeBoundingSphere();
    return g;
  }, [data]);
  const river = useMemo(() => { // a flat current of motes below the rings (deterministic)
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const pos = new Float32Array(dust * 3), col = new Float32Array(dust * 3), c = new THREE.Color();
    for (let i = 0; i < dust; i++) {
      pos.set([(rnd() - 0.5) * 9, -R * 0.95 + (rnd() - 0.5) * 0.5, rnd() * AHEAD * DZ * 0.5], i * 3);
      c.set("#9ec9ff").multiplyScalar(0.3 + rnd() * 0.5); col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry(), one = (v: number) => new THREE.BufferAttribute(new Float32Array(dust).fill(v), 1);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", one(0.05)); g.setAttribute("aDay", one(0)); g.setAttribute("aIdx", one(-1)); g.setAttribute("aFlow", one(1));
    return g;
  }, [dust]);
  useEffect(() => () => { rings.dispose(); pts.dispose(); river.dispose(); }, [rings, pts, river]);
  useEffect(() => () => { mats.ring.dispose(); mats.pt.dispose(); }, [mats]);
  useEffect(() => { uniforms.uSel.value = sel ?? -1; }, [sel, uniforms]);

  const cam = useRef({ h: headRef.current, v: { v: 0 } });
  useFrame(({ clock }, raw) => {
    const dt = Math.min(Math.max(raw, 0), 0.1), c = cam.current;
    c.h = reduced ? headRef.current : smoothDamp(c.h, headRef.current, c.v, 0.35, dt);
    const z = -c.h * DZ, sway = reduced ? 0 : Math.sin(clock.elapsedTime * 0.11) * 0.25;
    camera.position.set(sway, 1.1, z + 6.5);
    camera.lookAt(0, 0, z - 30);
    uniforms.uHead.value = c.h;
    uniforms.uTime.value = reduced ? 0 : clock.elapsedTime % 1000;
    uniforms.uScale.value = (size.height * gl.getPixelRatio()) / (2 * Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360));
  });
  const near = (i: number) => { const d = dayIndex(data.from, data.moments[i].day) - headRef.current; return d > -BEHIND && d < 60; };
  return <WarmIn>
    <mesh geometry={rings} material={mats.ring} frustumCulled={false} raycast={() => null} />
    <points geometry={river} material={mats.pt} frustumCulled={false} raycast={() => null} />
    <points geometry={pts} material={mats.pt} frustumCulled={false}
      onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (!dragged.current && e.index != null && near(e.index)) onPick(e.index); }} />
  </WarmIn>;
}

const fmt = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default function Chronicle({ reduced, quality = "auto", paused = false, slot }: { reduced: boolean; quality?: QualityMode; paused?: boolean; slot: HTMLElement | null }) {
  const glr = useGlRecovery();
  const later = useMountLater();
  const q = useLeanQuality(quality);
  const [priv, setPriv] = useState(false);
  const [voice, setVoice] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [shown, setShown] = useState(0); // the head's day, for the HUD (the scene reads headRef every frame)
  const [sel, setSel] = useState<number | null>(null);
  const [playing, setPlaying] = useState<null | "week" | "month">(null);
  const [caption, setCaption] = useState("");
  const [lastYear, setLastYear] = useState<Moment[] | null>(null);
  const headRef = useRef(0), dragged = useRef(false), titled = useRef(false), placed = useRef(false);
  useEffect(() => setPriv(readPriv()), []);

  useEffect(() => {
    if (paused) return;
    let live = true;
    fetch(`/api/chronicle${priv ? "?private=1" : ""}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Could not load the chronicle (${r.status})`);
      if (!live) return;
      const d = j as Data;
      if (!placed.current) { placed.current = true; headRef.current = Math.max(0, d.days.length - 8); setShown(Math.round(headRef.current)); } // start a week back, looking at today
      setData(d);
      setSel(null); setErr("");
      const month = d.untitled?.at(-1); // name the newest finished month's weeks: one fast-model call per month, server-guarded
      if (month && !titled.current) {
        titled.current = true;
        fetch("/api/chronicle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ month }) })
          .then((r) => r.json()).then((t: { titles?: Record<string, string> }) => {
            if (live && t.titles && Object.keys(t.titles).length) setData((cur) => cur && { ...cur, arcs: cur.arcs.map((a) => t.titles![a.week] ? { ...a, title: t.titles![a.week], auto: false } : a) });
          }).catch(() => {});
      }
    }).catch((e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [priv, paused]);

  const last = data ? data.days.length - 1 : 0;
  const go = (d: number) => { headRef.current = Math.min(Math.max(d, 0), last); setShown(Math.round(headRef.current)); };
  // play: advance the head, captions from narrate() as their day comes up
  useEffect(() => {
    if (!playing || !data || paused) return;
    const start = Math.floor(headRef.current), span = playing === "week" ? 7 : 30, end = Math.min(last, start + span);
    const lines = narrate(data, start, end);
    let i = 0, prev = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      headRef.current = Math.min(end, headRef.current + ((now - prev) / 1000) * SPEED[playing]);
      prev = now;
      setShown(Math.round(headRef.current));
      while (i < lines.length && lines[i].day <= headRef.current) {
        const text = lines[i++].text;
        setCaption(text);
        if (voice && speechSettings().speak) speakChunk(text);
      }
      if (headRef.current >= end) { setPlaying(null); }
    }, reduced ? 400 : 100);
    return () => clearInterval(t);
  }, [playing, data, last, voice, reduced, paused]);
  useEffect(() => { if (!playing) stopSpeech(); }, [playing]);
  useEffect(() => { if (!caption) return; const t = setTimeout(() => setCaption(""), 6000); return () => clearTimeout(t); }, [caption]);

  // scrub: wheel and vertical/horizontal drag on the canvas move through days
  const drag = useRef<{ x: number; y: number; h: number } | null>(null);
  const handlers = {
    onWheel: (e: React.WheelEvent) => { setPlaying(null); go(headRef.current + (e.deltaY + e.deltaX) * 0.012); },
    onPointerDown: (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, h: headRef.current }; dragged.current = false; },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!dragged.current && Math.hypot(dx, dy) < 5) return;
      dragged.current = true; setPlaying(null);
      go(d.h + (dy - dx) * 0.04); // drag down or left = forward in time
    },
    onPointerUp: () => { drag.current = null; },
    onPointerLeave: () => { drag.current = null; },
  };

  const day = data?.days[shown];
  const arc = data && day ? data.arcs.find((a) => a.week <= day.day && a.to >= day.day) : undefined;
  const m = sel !== null ? data?.moments[sel] : undefined;
  const open = (l: Link) => dispatchEvent(l.kind === "memory" ? new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id: l.id } }) : new CustomEvent(OPEN_SOURCE_EVENT, { detail: l }));
  const pick = (i: number) => { setSel(i); setPlaying(null); };
  const lanes = useMemo(() => [...new Set(data?.moments.map((x) => x.planet))], [data]);
  const togglePriv = () => { const v = !priv; try { localStorage.setItem(PRIV_KEY, v ? "1" : "0"); } catch {} setPriv(v); };
  const onCreated = (s: RootState) => { glr.onCreated(s); s.raycaster.params.Points = { threshold: 0.3 }; };

  const panel = <div className="space-y-3">
    {err && <p className="error" role="alert">{err}</p>}
    {!data && !err && <p className="muted" role="status">Charting your timeline…</p>}
    {data && day && <>
      <div>
        <div className="font-medium">{fmt(day.day)}</div>
        {arc && <p className="muted text-xs">{arc.title}{arc.auto ? "" : " · titled by CORE"}</p>}
      </div>
      <div role="group" aria-label="Chronicle timeline" className="flex items-center gap-2 text-xs">
        <input type="range" min={0} max={last} step={1} value={shown} className="h-1 min-w-0 flex-1 accent-sky-300"
          aria-label="Day in your chronicle" aria-valuetext={fmt(day.day)} onChange={(e) => { setPlaying(null); go(Number(e.target.value)); }} />
        <button className="chip" onClick={() => { setPlaying(null); go(last); }} disabled={shown === last}>Today</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button className="chip" aria-pressed={playing === "week"} onClick={() => setPlaying(playing === "week" ? null : "week")}>{playing === "week" ? "Pause" : "Play week"}</button>
        <button className="chip" aria-pressed={playing === "month"} onClick={() => setPlaying(playing === "month" ? null : "month")}>{playing === "month" ? "Pause" : "Play month"}</button>
        <button className="chip" onClick={() => { const ms = dayLastYear(data, day.day); setLastYear(ms); const t = ms[0]; if (t) { go(dayIndex(data.from, t.day)); setSel(data.moments.indexOf(t)); } }}>This day last year</button>
      </div>
      <div className="flex flex-wrap gap-3 text-[11px]">
        <label className="muted flex items-center gap-1.5"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />Narrate with CORE&apos;s voice</label>
        <label className="muted flex items-center gap-1.5"><input type="checkbox" checked={priv} onChange={togglePriv} />Include private (journal, on this device only)</label>
      </div>
      {lastYear && <div className="card space-y-1 text-xs">
        <div className="muted text-[10px] uppercase tracking-widest">This day last year</div>
        {lastYear.length ? <ul className="space-y-0.5">{lastYear.map((x) => <li key={x.id}><button className="chip w-full justify-between text-left" onClick={() => { go(dayIndex(data.from, x.day)); setSel(data.moments.indexOf(x)); }}>
          <span className="truncate">{x.title}</span><span className="muted">{x.day.slice(5)}</span></button></li>)}</ul> : <p className="muted">Nothing a year ago around this day.</p>}
      </div>}
      {m && <div className="card space-y-1">
        <div className="font-medium">{m.title}</div>
        <p className="muted text-xs">{m.first ? `${m.first} · ` : ""}{planetById(m.planet)?.name ?? m.planet.toUpperCase()} · {new Date(m.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{m.private ? " · private" : ""}</p>
        {m.links.length > 0 && <div className="flex flex-wrap gap-1.5">{m.links.map((l) => <button key={l.id} className="btn" onClick={() => open(l)}>Open {l.kind === "memory" ? "memory" : l.kind.replace("week:", "")}</button>)}</div>}
      </div>}
      {data.streaks.length > 0 && <div className="text-xs">
        <div className="muted text-[10px] uppercase tracking-widest">Streaks</div>
        <ul>{data.streaks.map((s) => <li key={s.what + s.from}><button className="chip mt-1" onClick={() => go(dayIndex(data.from, s.from))}>{s.what}: {s.days} days · {s.from.slice(5)} → {s.to.slice(5)}</button></li>)}</ul>
      </div>}
      {lanes.length > 0 && <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" aria-label="Legend">
        {lanes.map((p) => <li key={p} className="muted flex items-center gap-1.5"><i aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9, background: colorOf(p), boxShadow: `0 0 6px ${colorOf(p)}` }} />{planetById(p)?.name ?? p.toUpperCase()}</li>)}
      </ul>}
      <p className="muted text-[11px]">Each ring is a day, flowing away into the future; points are moments in their planet&apos;s colour, bright beacons are the big ones and firsts. Scroll or drag to move through time, click a point to open it.</p>
    </>}
  </div>;

  return <>
    <div className="absolute inset-0" style={{ background: BG, touchAction: "none" }} {...handlers}>
      {later && data && <Canvas key={glr.key} onCreated={onCreated} frameloop={paused ? "never" : "always"} camera={{ position: [0, 1.1, 6.5], fov: 55, near: 0.1, far: 400 }}
        dpr={[1, q.dpr]} gl={{ antialias: false }} onPointerMissed={() => { if (!dragged.current) setSel(null); }}>
        {quality === "auto" && <PerformanceMonitor onDecline={q.onDecline} />}
        <WarmCompile world="chronicle" />
        <color attach="background" args={[BG]} />
        <River data={data} headRef={headRef} sel={sel} reduced={reduced} dust={q.bloomScale === 0 ? 300 : 1200} onPick={pick} dragged={dragged} />
        {q.bloomScale > 0 && <EffectComposer multisampling={q.msaa}>
          <Bloom intensity={(reduced ? 0.35 : 0.6) * q.bloomScale} luminanceThreshold={0.55} luminanceSmoothing={0.3} mipmapBlur />
          <Vignette offset={0.3} darkness={0.75} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>}
      </Canvas>}
    </div>
    {caption && <p className="chronicle-caption pointer-events-none absolute inset-x-4 top-24 z-[13] mx-auto max-w-xl text-center" aria-live="polite">{caption}</p>}
    {slot && createPortal(panel, slot)}
  </>;
}
