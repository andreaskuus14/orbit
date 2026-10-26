"use client";
// ARCH planet: a study workspace for small buildings. Blocks in metres on a plot; edit by typing to CORE or directly with the numbers.
// Quantities and euros are computed in arch-pure.ts from the geometry, never by the AI. Learning tool, not certification.
import { WarmCompile } from "./WarmCompile";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { QualityMode } from "@/lib/quality-pure";
import { useLeanQuality } from "./useLeanQuality";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Edges, Line, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { useGlRecovery } from "./useGlRecovery";
import { dayArc, sunDirection, sunPosition } from "@/lib/sun-pure";
import { MAX, applyOps, boq, boqCsv, bulkTips, costLines, isOpening, isStraightWall, RULES, starterScene, STARTER_PRICES, type Op, type Part, type PriceItem, type Scene } from "@/lib/arch-pure";
import { lessonNote, lessonScene, quizScore, type Lesson } from "@/lib/arch-lesson-pure";
import { speakChunk, speechSettings, stop as stopSpeech } from "./voice/speak";
import { buildFront, lidarDots, moveWalker, NO_FRONT, WALK, wallRects, walkStart, type Rect } from "@/lib/arch-walk-pure";
import { splatBudget } from "@/lib/splat-pure";
import { lessonTag } from "@/lib/arch-studio-pure";
import { quizCards } from "@/lib/study-pure";
import { SplatCloud, makeSplatWorker, type ScanData } from "./SplatCloud";
import { ArchStudio } from "./ArchStudio";
import { MeasureLayer, MeasurePanel, measureFrom, type MeasureState } from "./ScanMeasure";

const KEY = "orbit.arch.v1";
// Architectural-model look: warm whites and stone, thin dark edges, a pale blueprint ground.
const COLOR: Record<Part["kind"], string> = { foundation: "#a8a29e", slab: "#d6d3d1", wall: "#f5f2ec", roof: "#e7e2d9", window: "#33475b", door: "#6b4f3a" };
const FACE_ROT = { n: Math.PI, s: 0, e: Math.PI / 2, w: -Math.PI / 2 }; // turns local +Z to face outward
const GROUND: Record<Scene["plot"]["ground"], string> = { grass: "#c9d3bf", gravel: "#d9d6cf", forest: "#b9c6b0", sand: "#e6dcc6" };
const BG = "#ebe7e0", GOLD = "#c9a24a";
const HOLO_C = { bg: "#020a10", table: "#04141c", rim: "#67e8f9", dot: "#22d3ee", edge: "#a5f3fc" }; // holotable mode
const SCAN_BG = "#05080c"; // scans read best on near-black, like a dark studio
const BP = { bg: "#0b2545", ground: "#0e2f56", fill: "#123a66", edge: "#e0f2fe", grid: ["#5b8bc4", "#1d4a7c"] as const }; // blueprint mode
const SITE = { lat: 59.437, lon: 24.754, name: "Tallinn" }; // sun study location; shortcut: fixed site, add a picker if he studies other places
const TP = new THREE.Vector3(), TS = new THREE.Vector3(); // per-frame scratch
const STEP_S = 0.45; // build animation: one part every 0.45 s, bottom to top

/** Unit gable roof (1 × 1 × 1, ridge along x), so a roof part scales like a box but reads as a roof. A low roof (< 0.5 m) is flat. */
const GABLE = (() => {
  const sh = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
  g.translate(0, -0.5, -0.5); g.rotateY(Math.PI / 2); // centred like a unit box, ridge along x
  return g;
})();
/** Hologram look, one material shared by every block: translucent cyan, fresnel edges, fixed slices, a sweep band rising, a faint
 *  flicker, and nothing drawn above uFront (the ▶ Build "print" height). Uniforms are set in place each frame by HoloClock. */
const HOLO = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uFront: { value: NO_FRONT }, uMotion: { value: 1 }, uColor: { value: new THREE.Color("#22d3ee") } },
  vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; vec4 mv = viewMatrix * w; vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uTime; uniform float uFront; uniform float uMotion; uniform vec3 uColor;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  if (vY > uFront) discard;
  float fres = pow(1.0 - clamp(abs(dot(normalize(vN + 1e-6), normalize(vV + 1e-6))), 0.0, 1.0), 2.0);
  float slices = 0.25 * smoothstep(0.9, 1.0, fract(vY * 3.0));
  float sweep = uMotion * smoothstep(0.95, 1.0, fract(vY * 0.15 - uTime * 0.25));
  float front = uFront < 9999.0 ? 1.0 - smoothstep(0.0, 0.12, uFront - vY) : 0.0;
  float flick = 1.0 - uMotion * 0.08 * (0.5 + 0.5 * sin(uTime * 41.0) * sin(uTime * 17.3));
  float a = clamp((0.08 + 0.55 * fres + slices + 0.6 * sweep + 0.9 * front) * flick, 0.0, 1.0);
  gl_FragColor = vec4(max(uColor * (0.5 + fres + 1.2 * sweep + 2.0 * front), vec3(0.0)), a);
}`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
});
const load = (): { scene: Scene; prices: PriceItem[] } | null => { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const eur = (n: number) => n.toLocaleString("et-EE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const download = (name: string, text: string, type: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
let seq = Date.now();
const newId = () => `p${(seq++).toString(36)}`;

/** One block that eases toward its target size/position each frame: edits glide instead of jumping. */
function Block({ p, selected, onPick, reduced, appearAt, hidden, bp, holo, inside }: { p: Part; selected: boolean; onPick: () => void; reduced: boolean; appearAt: number; hidden: boolean; bp: boolean; holo: boolean; inside: boolean }) {
  const m = useRef<THREE.Mesh>(null);
  const target = useMemo(() => ({ pos: new THREE.Vector3(p.x, p.y + p.h / 2, p.z), scale: new THREE.Vector3(p.w, p.h, p.d) }), [p.x, p.y, p.z, p.w, p.d, p.h]);
  const [start] = useState(() => ({ pos: target.pos.clone(), scale: target.scale.clone() })); // set once: later changes glide in useFrame
  useFrame(({ clock }, dt) => {
    if (!m.current) return;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 10);
    // before its turn in the build animation a part waits flat on its base; then it rises into place
    const wait = !reduced && clock.elapsedTime < appearAt;
    m.current.visible = !hidden && !wait;
    m.current.position.lerp(wait ? TP.set(p.x, p.y, p.z) : target.pos, k);
    m.current.scale.lerp(wait ? TS.set(p.w, 0.001, p.d) : target.scale, k);
  });
  return (
    <mesh ref={m} position={start.pos} scale={start.scale} castShadow receiveShadow onClick={(e) => { if (!e.object.visible) return; e.stopPropagation(); onPick(); }}>
      {p.kind === "roof" && p.h >= 0.5 ? <primitive object={GABLE} attach="geometry" /> : <boxGeometry args={[1, 1, 1]} />}
      {holo ? <primitive object={HOLO} attach="material" />
        // inside: walking, so the walls' inner faces show (a block is solid; its faces point outward)
        : <meshStandardMaterial color={bp ? BP.fill : COLOR[p.kind]} roughness={0.9} transparent={bp} opacity={bp ? 0.35 : 1} depthWrite={!bp} side={inside ? THREE.DoubleSide : THREE.FrontSide} emissive={selected ? GOLD : "#000"} emissiveIntensity={selected ? 0.25 : 0} />}
      <Edges threshold={20} color={selected ? GOLD : holo ? HOLO_C.edge : bp ? BP.edge : "#57534e"} />
    </mesh>
  );
}

/** A window or door drawn on its wall face: a dark inset panel (glass or door leaf) with a frame. shortcut: no real hole (CSG); fine
 *  for a massing model, upgrade if section views need it. Hidden until its wall has risen in the build animation. */
function Opening({ p, selected, onPick, appearAt, reduced, bp, holo }: { p: Part; selected: boolean; onPick: () => void; appearAt: number; reduced: boolean; bp: boolean; holo: boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (g.current) g.current.visible = reduced || clock.elapsedTime >= appearAt; });
  return (
    <group ref={g} position={[p.x, p.y + p.h / 2, p.z]} rotation={[0, FACE_ROT[p.face ?? "s"], 0]} onClick={(e) => { e.stopPropagation(); onPick(); }}>
      <mesh position={[0, 0, 0.01]}><boxGeometry args={[p.w, p.h, 0.02]} />
        {holo ? <primitive object={HOLO} attach="material" /> : <meshStandardMaterial color={bp ? BP.bg : COLOR[p.kind]} roughness={p.kind === "window" ? 0.15 : 0.8} metalness={p.kind === "window" ? 0.3 : 0} emissive={selected ? GOLD : "#000"} emissiveIntensity={selected ? 0.3 : 0} />}</mesh>
      <mesh position={[0, 0, 0.03]}><boxGeometry args={[p.w, p.h, 0.04]} /><meshBasicMaterial visible={false} />
        <Edges color={selected ? GOLD : holo ? HOLO_C.edge : bp ? BP.edge : "#3f3a35"} /></mesh>
    </group>
  );
}

function Trees({ n, w, d }: { n: number; w: number; d: number }) {
  // deterministic spots along the plot edge, so trees don't jump around on every render
  const spots = useMemo(() => Array.from({ length: n }, (_, i) => { const t = (i * 0.618) % 1, side = i % 4, e = 0.45;
    return side === 0 ? [(t - 0.5) * w, -d * e] : side === 1 ? [(t - 0.5) * w, d * e] : side === 2 ? [-w * e, (t - 0.5) * d] : [w * e, (t - 0.5) * d]; }), [n, w, d]);
  return <>{spots.map(([x, z], i) => <mesh key={i} position={[x, 2, z]} castShadow><coneGeometry args={[1, 4, 7]} /><meshStandardMaterial color="#a3b18a" roughness={1} /></mesh>)}</>;
}

/** Gold blueprint lines: the footprint of everything at ground level, drawn under the model. */
const Blueprint = memo(function Blueprint({ parts }: { parts: Part[] }) {
  return <>{parts.filter((p) => p.y <= 0.01 && !isOpening(p.kind)).map((p) => {
    const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2, y = 0.02;
    return <Line key={p.id} points={[[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, y, z0]]} color={GOLD} lineWidth={1.5} />;
  })}</>;
});

/** Restart point for the build animation, in canvas clock seconds. */
function BuildClock({ run, onStart }: { run: number; onStart: (t: number) => void }) {
  const last = useRef(-1);
  useFrame(({ clock }) => { if (last.current !== run) { last.current = run; onStart(clock.elapsedTime); } });
  return null;
}

/** Drives the shared hologram material: time, the build "print" height, motion off for reduced motion. No allocations. */
function HoloClock({ solid, t0, reduced }: { solid: Part[]; t0: number; reduced: boolean }) {
  useFrame(({ clock }) => {
    const u = HOLO.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uMotion.value = reduced ? 0 : 1;
    u.uFront.value = reduced ? NO_FRONT : buildFront(solid, clock.elapsedTime, t0);
  });
  return null;
}

/** The plot as a holotable: a dark disc, a glowing rim and a LIDAR dot grid. */
function HoloTable({ w, d }: { w: number; d: number }) {
  const r = Math.hypot(w, d) / 2;
  const dots = useMemo(() => new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(lidarDots(r), 3)), [r]);
  useEffect(() => () => dots.dispose(), [dots]);
  return <>
    <mesh rotation-x={-Math.PI / 2} receiveShadow><circleGeometry args={[r, 96]} /><meshBasicMaterial color={HOLO_C.table} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position-y={0.02}><ringGeometry args={[r - 0.12, r, 128]} /><meshBasicMaterial color={HOLO_C.rim} toneMapped={false} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position-y={0.015}><ringGeometry args={[r - 0.9, r, 128]} /><meshBasicMaterial color={HOLO_C.rim} transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    <points geometry={dots}><pointsMaterial color={HOLO_C.dot} size={0.07} transparent opacity={0.7} depthWrite={false} /></points>
  </>;
}

/** First-person walk at eye height: WASD / arrows move, drag looks, Esc exits. Walls block (arch-walk-pure), doors are gaps.
 *  shortcut: drag-look only, no PointerLock; add it if drag feels clumsy. Restores the orbit camera on exit. */
function Walker({ rects, plot, onExit }: { rects: Rect[]; plot: { w: number; d: number }; onExit: () => void }) {
  const { camera, gl } = useThree();
  const st = useRef({ x: 0, z: 0, yaw: 0, pitch: 0, keys: new Set<string>() });
  const rectsRef = useRef(rects), plotRef = useRef(plot); // refs: an edit mid-walk must not reset the walk or the saved camera
  rectsRef.current = rects; plotRef.current = plot;
  const exit = useRef(onExit);
  exit.current = onExit;
  useEffect(() => {
    const saved = camera.position.clone(), savedQ = camera.quaternion.clone(), s = st.current, el = gl.domElement;
    Object.assign(s, walkStart(plotRef.current, rectsRef.current), { pitch: 0 });
    const MOVE = /^(w|a|s|d|arrowup|arrowdown|arrowleft|arrowright)$/;
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector("dialog[open], :popover-open")) return; // a modal/popover owns the keys (and its own Esc)
      const k = e.key.toLowerCase();
      // preventDefault: Orbit's own keys (Esc closes the world, ←/→ change planet) skip handled events
      if (k === "escape") { e.preventDefault(); exit.current(); } else if (MOVE.test(k)) { e.preventDefault(); s.keys.add(k); }
    };
    const up = (e: KeyboardEvent) => s.keys.delete(e.key.toLowerCase());
    let drag = -1, lx = 0, ly = 0;
    const pd = (e: PointerEvent) => { drag = e.pointerId; lx = e.clientX; ly = e.clientY; };
    const pm = (e: PointerEvent) => {
      if (e.pointerId !== drag) return;
      s.yaw -= (e.clientX - lx) * 0.004; s.pitch = Math.max(-1.2, Math.min(1.2, s.pitch - (e.clientY - ly) * 0.004));
      lx = e.clientX; ly = e.clientY;
    };
    const pu = () => { drag = -1; };
    const blur = () => s.keys.clear();
    addEventListener("keydown", down, true); addEventListener("keyup", up); addEventListener("blur", blur);
    el.addEventListener("pointerdown", pd); addEventListener("pointermove", pm); addEventListener("pointerup", pu);
    return () => {
      removeEventListener("keydown", down, true); removeEventListener("keyup", up); removeEventListener("blur", blur);
      el.removeEventListener("pointerdown", pd); removeEventListener("pointermove", pm); removeEventListener("pointerup", pu);
      s.keys.clear(); camera.position.copy(saved); camera.quaternion.copy(savedQ);
    };
  }, [camera, gl]);
  useFrame((_, dt) => {
    const s = st.current, k = s.keys, d = Math.min(dt, 0.1) * WALK.speed;
    const f = +(k.has("w") || k.has("arrowup")) - +(k.has("s") || k.has("arrowdown")), r = +(k.has("d") || k.has("arrowright")) - +(k.has("a") || k.has("arrowleft"));
    if (f || r) {
      const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw); // forward = (−sin, −cos), right = (cos, −sin)
      const n = moveWalker(s.x, s.z, (-sin * f + cos * r) * d, (-cos * f - sin * r) * d, rectsRef.current, plotRef.current);
      s.x = n.x; s.z = n.z;
    }
    camera.position.set(s.x, WALK.eye, s.z);
    camera.rotation.set(s.pitch, s.yaw, 0, "YXZ");
  });
  return null;
}

export default function ArchWorld({ onClose, reduced, flat, quality = "auto", paused = false }: { onClose: () => void; reduced: boolean; flat?: boolean; quality?: QualityMode; paused?: boolean /* kept mounted but hidden */ }) {
  const qualityPreset = useLeanQuality(quality);
  const glr = useGlRecovery();
  const [scene, setScene] = useState<Scene>(starterScene);
  const [prices, setPrices] = useState<PriceItem[]>(STARTER_PRICES);
  const [past, setPast] = useState<Scene[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [run, setRun] = useState(0), [t0, setT0] = useState(0); // ▶ Build replays the assembly
  const [noRoof, setNoRoof] = useState(false), [spin, setSpin] = useState(false);
  const [mode, setMode] = useState<"model" | "bp" | "holo">("model"), bp = mode === "bp", holo = mode === "holo";
  const [walk, setWalk] = useState(false);
  const [sun, setSun] = useState<{ on: boolean; date: string; hour: number }>(() => ({ on: false, date: new Date().toISOString().slice(0, 10), hour: 12 }));
  const sunAt = useMemo(() => { const d = new Date(`${sun.date}T00:00`); d.setMinutes(Math.round(sun.hour * 60)); return d; }, [sun.date, sun.hour]);
  const sunInfo = useMemo(() => {
    try {
      const pos = sunPosition(SITE.lat, SITE.lon, sunAt), dir = sunDirection(SITE.lat, SITE.lon, sunAt), arc = dayArc(SITE.lat, SITE.lon, new Date(`${sun.date}T12:00Z`));
      return { pos, dir, arc };
    } catch { return null; }
  }, [sunAt, sun.date]);
  const lightPos: [number, number, number] = sun.on && sunInfo ? [sunInfo.dir.x * 40, Math.max(0.5, sunInfo.dir.y * 40), sunInfo.dir.z * 40] : [-14, 22, 12];
  const night = sun.on && !!sunInfo && sunInfo.pos.elevationDeg < 0;
  // ARCH studio (5.1–5.4): an open splat scan replaces the model in the canvas; the worker parses and depth-sorts it.
  const [scan, setScan] = useState<ScanData | null>(null), [flip, setFlip] = useState(false), [bump, setBump] = useState(0);
  const [worker] = useState(makeSplatWorker);
  const [meas, setMeas] = useState<MeasureState | null>(null); // 5.5 measure, loaded from the scan's note
  useEffect(() => () => worker.stop(), [worker]);
  const budget = splatBudget(qualityPreset.dpr);
  const bg = scan ? SCAN_BG : holo ? HOLO_C.bg : bp ? BP.bg : night ? "#1c2230" : BG;
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // 📚 Teach me: a precedent lesson; ch === chapters.length is the quiz. The user's own scene is kept aside and comes back at the end.
  const [lesson, setLesson] = useState<Lesson | null>(null), [ch, setCh] = useState(0), [answers, setAnswers] = useState<(number | null)[]>([]);
  const [topic, setTopic] = useState(""), [lessonBusy, setLessonBusy] = useState(false), [lessonMsg, setLessonMsg] = useState("");
  const ownScene = useRef<Scene | null>(null);
  const [ready, setReady] = useState(false); // state, not a ref: the save effect must not run with the starter scene before the load lands
  useEffect(() => {
    const s = load();
    if (s?.scene?.parts) {
      setScene(s.scene);
      if (Array.isArray(s.prices)) setPrices(STARTER_PRICES.map((d) => { const x = s.prices.find((p) => p.key === d.key); return x && Number.isFinite(x.eur) ? { ...d, ...x } : d; }));
    }
    setReady(true);
  }, []);
  useEffect(() => { if (ready && !lesson) try { localStorage.setItem(KEY, JSON.stringify({ scene, prices })); } catch { /* private mode: the scene just isn't kept */ } }, [scene, prices, ready, lesson]);

  const sceneRef = useRef(scene);
  sceneRef.current = scene; // an AI reply applies to the scene as it is when it lands, not when it was asked
  const apply = (ops: Op[]) => { const cur = sceneRef.current, r = applyOps(cur, ops, newId); sceneRef.current = r.scene; setPast((p) => [...p.slice(-30), cur]); setScene(r.scene); return r.moved; };
  const undo = () => setPast((p) => { if (p.length) setScene(p[p.length - 1]); return p.slice(0, -1); });
  const q = boq(scene.parts), cost = costLines(q, prices), tips = bulkTips(q);
  const part = scene.parts.find((p) => p.id === sel);
  const shell = scene.parts.find((p) => p.kind === "wall" && !isStraightWall(p));
  // one straight wall across the middle of the first floor's shell, standing on its floor
  const addInterior = () => { if (shell) { apply([{ op: "add", kind: "wall", name: "Interior wall", x: shell.x, z: shell.z, w: Math.max(0.5, shell.w - 2 * RULES.wallThick), d: 0.2, h: shell.h, y: shell.y }]); } };
  const host = part?.kind === "wall" ? part : undefined;
  const solid = useMemo(() => [...scene.parts].filter((p) => !isOpening(p.kind)).sort((a, b) => a.y - b.y), [scene.parts]);
  const rects = useMemo(() => wallRects(scene.parts), [scene.parts]);
  const plotWD = useMemo(() => ({ w: scene.plot.w, d: scene.plot.d }), [scene.plot.w, scene.plot.d]);
  // walking a scan: no walls, kept inside the scan's extent (+2 m)
  const noRects = useMemo<Rect[]>(() => [], []);
  const scanPlot = useMemo(() => scan && { w: scan.bounds.hi[0] - scan.bounds.lo[0] + 4, d: scan.bounds.hi[2] - scan.bounds.lo[2] + 4 }, [scan]);

  async function send() {
    if (!cmd.trim() || busy) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/arch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scene, command: cmd }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      const moved = apply(j.ops as Op[]);
      setMsg(`${j.say || "Done."}${moved.length ? ` Moved ${moved.length} part${moved.length === 1 ? "" : "s"} above to keep it stacked.` : ""}`);
      setCmd("");
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  const goTo = (l: Lesson, i: number) => {
    setCh(i); setSel(null); stopSpeech();
    if (i >= l.chapters.length) return;
    const s = lessonScene(l, i);
    sceneRef.current = s; setScene(s); setRun((n) => n + 1);
    if (speechSettings().speak) for (const line of `${l.chapters[i].title}. ${l.chapters[i].text}`.split(/(?<=[.!?])\s+/)) if (line) speakChunk(line);
  };
  async function teach(t = topic) {
    if (!t.trim() || lessonBusy) return;
    setLessonBusy(true); setLessonMsg("");
    try {
      const r = await fetch("/api/arch/lesson", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: t }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      const l = j.lesson as Lesson;
      if (!lesson) ownScene.current = sceneRef.current;
      setLesson(l); setAnswers(l.quiz.map(() => null)); setMode("holo"); setTopic(""); setScan(null);
      goTo(l, 0);
    } catch (e) { setLessonMsg((e as Error).message); } finally { setLessonBusy(false); }
  }
  const endLesson = () => {
    stopSpeech(); setLesson(null); setLessonMsg(""); setSel(null);
    if (ownScene.current) { sceneRef.current = ownScene.current; setScene(ownScene.current); ownScene.current = null; }
  };
  async function saveLesson() {
    if (!lesson) return;
    const n = lessonNote(lesson, answers);
    const r = await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "note", ...n, tags: ["arch", "lesson", lessonTag(lesson.building)].filter(Boolean) }) }).catch(() => null);
    setLessonMsg(r?.ok ? "Saved to MEMORY." : "Couldn't save the lesson.");
    if (r?.ok) setBump((b) => b + 1);
  }
  async function studyQuiz() { // the quiz becomes study cards in MEMORY (spaced repetition)
    if (!lesson) return;
    const r = await fetch("/api/study", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", source: "arch", ref: lesson.building, cards: quizCards(lesson.quiz) }) }).catch(() => null);
    setLessonMsg(r?.ok ? "Quiz added to your study cards in MEMORY." : "Couldn't add the study cards.");
  }
  const focus = new Set(lesson && ch < lesson.chapters.length ? lesson.chapters[ch].focus : []);

  const field = (k: "w" | "d" | "h" | "x" | "z" | "off" | "sill", label: string) => part && <NumField key={`${part.id}-${k}-${part[k]}`} label={label} name={part.name} value={part[k] ?? 0} pos={k === "x" || k === "z" || k === "off"}
    onCommit={(v) => apply([{ op: "set", id: part.id, [k]: v }])} />;

  return (
    <div role="region" className="absolute inset-0 globe-in" aria-label="ARCH: architecture study workspace" style={{ background: bg }}>
      {!flat && (
        <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={paused ? "never" : "always"} shadows dpr={[1, qualityPreset.dpr]} camera={{ position: [18, 14, 18], fov: 45 }} onPointerMissed={() => setSel(null)}>
        <WarmCompile world="arch" />
        {quality === "auto" && <PerformanceMonitor onDecline={qualityPreset.onDecline} />}
          <color attach="background" args={[bg]} />
          <fog attach="fog" args={[bg, 60, 140]} />
          <hemisphereLight args={["#ffffff", "#d6cfc4", 0.9]} />
          <directionalLight position={lightPos} intensity={night ? 0.05 : 1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} />
          {scan ? <SplatCloud scan={scan} worker={worker} cap={budget.cap} maxPx={budget.maxPx} flip={flip}>
            {meas && <MeasureLayer m={meas} set={setMeas} worker={worker} ext={Math.max(...scan.bounds.hi.map((h, i) => h - scan.bounds.lo[i]))} />}
          </SplatCloud> : <>
          {holo ? <><HoloTable w={scene.plot.w} d={scene.plot.d} /><HoloClock solid={solid} t0={t0} reduced={reduced} /></> : <>
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[scene.plot.w, scene.plot.d]} /><meshStandardMaterial color={bp ? BP.ground : GROUND[scene.plot.ground]} roughness={1} /></mesh>
            <gridHelper args={[Math.max(scene.plot.w, scene.plot.d), Math.max(scene.plot.w, scene.plot.d), bp ? BP.grid[0] : "#cbbf9f", bp ? BP.grid[1] : "#ddd6c6"]} position={[0, 0.005, 0]} />
            <ContactShadows position={[0, 0.01, 0]} scale={Math.max(scene.plot.w, scene.plot.d)} opacity={0.35} blur={2.5} far={12} />
            <Blueprint parts={scene.parts} />
            <Trees n={scene.plot.trees} w={scene.plot.w} d={scene.plot.d} />
          </>}
          <BuildClock run={run} onStart={setT0} />
          {(() => { const at = (i: number) => t0 + 0.6 + i * STEP_S;
            return <>
              {solid.map((p, i) => <Block key={p.id} p={p} selected={p.id === sel || focus.has(p.id)} reduced={reduced} onPick={() => setSel(p.id)} appearAt={at(i)} hidden={noRoof && p.kind === "roof"} bp={bp} holo={holo} inside={walk} />)}
              {scene.parts.filter((p) => isOpening(p.kind)).map((p) => <Opening key={p.id} p={p} selected={p.id === sel} reduced={reduced} onPick={() => setSel(p.id)}
                appearAt={at(solid.findIndex((w) => w.id === p.host) + 1)} bp={bp} holo={holo} />)}
            </>; })()}
          </>}
          {walk && !paused && <Walker key={scan?.name ?? "model"} rects={scan ? noRects : rects} plot={scanPlot ?? plotWD} onExit={() => setWalk(false)} />}
          <OrbitControls makeDefault enabled={!walk} enableDamping maxPolarAngle={Math.PI / 2.05} autoRotate={spin && !reduced && !walk} autoRotateSpeed={0.8} />
        </Canvas>
      )}

      <section className="glass hud-panel world-panel panel-in absolute inset-x-3 bottom-32 z-[14] max-h-[45dvh] space-y-3 overflow-y-auto p-3 text-sm min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:right-3 min-[900px]:top-[4.5rem] min-[900px]:max-h-[calc(100dvh-11rem)] min-[900px]:w-[30rem]" aria-label="ARCH controls">
        <h2 className="brand text-base">ARCH</h2>
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input className="field flex-1" placeholder="Make the house 2 m longer · add a second floor · plot 40×30 with 12 trees" value={cmd} maxLength={500} onChange={(e) => setCmd(e.target.value)} aria-label="Tell CORE what to change" />
          <button className="btn" disabled={busy || !cmd.trim()}>{busy ? "Working…" : "Do it"}</button>
        </form>
        {msg && <p aria-live="polite">{msg}</p>}
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void teach(); }}>
          <input className="field flex-1" placeholder="Villa Savoye · Farnsworth House · Fallingwater · Kumu" value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} aria-label="A building to learn about" />
          <button className="btn" disabled={lessonBusy || !topic.trim()}>{lessonBusy ? "Writing…" : "📚 Teach me"}</button>
        </form>
        {lessonMsg && <p aria-live="polite">{lessonMsg}</p>}
        {lesson && (
          <div className="card space-y-2" aria-label={`Lesson: ${lesson.building}`}>
            <div className="muted text-[10px] uppercase tracking-widest">{lesson.building}{[lesson.architect, lesson.year, lesson.place].filter(Boolean).map((x) => ` · ${x}`).join("")}</div>
            {ch < lesson.chapters.length ? <div aria-live="polite">
              <div className="font-semibold">{ch + 1}/{lesson.chapters.length} · {lesson.chapters[ch].title}</div>
              <p className="text-xs">{lesson.chapters[ch].text}</p>
            </div> : <div className="space-y-2">
              <div className="font-semibold">Quiz · {quizScore(lesson.quiz, answers)}/{lesson.quiz.length}</div>
              {!lesson.quiz.length && <p className="muted text-xs">No quiz this time.</p>}
              {lesson.quiz.map((q, i) => <div key={i} className="space-y-1">
                <p className="text-xs">{q.q}</p>
                <div className="flex flex-wrap gap-1">{q.options.map((o, k) => <button key={k} className={`chip${answers[i] !== null && k === q.answer ? " ok" : answers[i] === k ? " error" : ""}`} aria-pressed={answers[i] === k} disabled={answers[i] !== null}
                  onClick={() => setAnswers((a) => a.map((x, j) => (j === i ? k : x)))}>{o}</button>)}</div>
                {answers[i] !== null && <p className="muted text-[11px]" aria-live="polite">{answers[i] === q.answer ? "Right. " : `No: ${q.options[q.answer]}. `}{q.why}</p>}
              </div>)}
            </div>}
            <div className="flex flex-wrap gap-1.5">
              <button className="chip" disabled={ch === 0} onClick={() => goTo(lesson, ch - 1)}>← Back</button>
              <button className="chip" disabled={ch >= lesson.chapters.length} onClick={() => goTo(lesson, ch + 1)}>{ch === lesson.chapters.length - 1 ? "Quiz →" : "Next →"}</button>
              <button className="chip" onClick={() => void saveLesson()}>Save lesson</button>
              {lesson.quiz.length > 0 && <button className="chip" onClick={() => void studyQuiz()} title="Spaced repetition in MEMORY">Study the quiz</button>}
              <button className="chip" onClick={endLesson} title="Back to your own model">End lesson</button>
            </div>
            <p className="muted text-[11px]">Simplified massing, dimensions approximate. Check facts against a book before you cite them.</p>
          </div>
        )}
        {scan && (
          <div className="card space-y-1.5" aria-label="Open scan">
            <div className="muted text-[10px] uppercase tracking-widest">Scan · {scan.name}</div>
            <p className="text-xs">{Math.min(scan.count, budget.cap).toLocaleString("en")} of {scan.count.toLocaleString("en")} splats drawn at this quality{scan.count < scan.total ? ` (file had ${scan.total.toLocaleString("en")})` : ""}. Drag to orbit, scroll or pinch to zoom; 🚶 Walk to go inside.</p>
            <div className="flex flex-wrap gap-1.5">
              <button className="chip" aria-pressed={flip} onClick={() => setFlip((v) => !v)} title="Some exports are upside down (y-down): turn the scan upright">↕ Flip upright</button>
              <button className="chip" onClick={() => { setScan(null); setMeas(null); setWalk(false); }}>Close scan</button>
            </div>
            {meas && <MeasurePanel m={meas} set={setMeas} onSaved={() => setBump((b) => b + 1)} />}
          </div>
        )}
        {walk && <p className="muted text-xs" aria-live="polite">Walking at 1.6 m: WASD or arrow keys move, drag to look around, Esc or 🚶 Walk to go back. Walls stop you; doors let you through.</p>}
        {sun.on && (
          <div className="card space-y-1.5" aria-label="Sun study">
            <div className="muted text-[10px] uppercase tracking-widest">Sun study · {SITE.name}</div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input className="field" type="date" value={sun.date} aria-label="Date" onChange={(e) => e.target.value && setSun((v) => ({ ...v, date: e.target.value }))} />
              {[["Jun 21", "-06-21"], ["Dec 21", "-12-21"]].map(([l, md]) => <button key={l} className="chip" onClick={() => setSun((v) => ({ ...v, date: v.date.slice(0, 4) + md }))}>{l}</button>)}
            </div>
            <label className="flex items-center gap-2 text-xs"><span className="num w-12">{String(Math.floor(sun.hour)).padStart(2, "0")}:{String(Math.round((sun.hour % 1) * 60)).padStart(2, "0")}</span>
              <input className="flex-1" type="range" min={0} max={24} step={0.25} value={sun.hour} aria-label="Time of day" onChange={(e) => setSun((v) => ({ ...v, hour: Number(e.target.value) }))} /></label>
            {sunInfo && <p className="muted text-xs">
              {sunInfo.pos.elevationDeg < 0 ? "Sun below the horizon" : `Sun ${Math.round(sunInfo.pos.elevationDeg)}° high, from ${Math.round(sunInfo.pos.azimuthDeg)}° (0° = north)`}
              {" · "}sunrise {((d: Date | null) => (d ? d.toLocaleTimeString("et-EE", { hour: "2-digit", minute: "2-digit" }) : "—"))(sunInfo.arc.sunrise)}, sunset {((d: Date | null) => (d ? d.toLocaleTimeString("et-EE", { hour: "2-digit", minute: "2-digit" }) : "—"))(sunInfo.arc.sunset)}. The plot's −Z side faces north.</p>}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <button className="chip" onClick={() => setRun((n) => n + 1)} title="Replay the assembly, bottom to top">▶ Build</button>
          <button className="chip" aria-pressed={noRoof} onClick={() => setNoRoof((v) => !v)}>Hide roof</button>
          <button className="chip" aria-pressed={spin} onClick={() => setSpin((v) => !v)}>Turntable</button>
          <button className="chip" aria-pressed={bp} onClick={() => setMode((m) => (m === "bp" ? "model" : "bp"))}>Blueprint</button>
          <button className="chip" aria-pressed={holo} onClick={() => setMode((m) => (m === "holo" ? "model" : "holo"))} title="The building as a hologram on a holotable">Holo</button>
          <button className="chip" aria-pressed={walk} disabled={flat} onClick={() => setWalk((v) => !v)} title="Walk through at eye height: WASD or arrows, drag to look, Esc to exit">🚶 Walk</button>
          <button className="chip" aria-pressed={sun.on} onClick={() => setSun((v) => ({ ...v, on: !v.on }))}>☀ Sun study</button>
          <button className="chip" disabled={!past.length} onClick={undo}>↶ Undo</button>
          <button className="chip" onClick={() => { setPast((p) => [...p, scene]); setScene(starterScene()); setSel(null); }}>Start over</button>
          <button className="chip" disabled={!shell} onClick={addInterior} title="A straight wall across the first floor; move or resize it with the numbers">+ Interior wall</button>
          <button className="chip" onClick={() => download("arch-bill-of-quantities.csv", boqCsv(cost), "text/csv")}>⬇ BOQ CSV</button>
          <button className="chip" onClick={() => download("arch-scene.json", JSON.stringify(scene, null, 2), "application/json")}>⬇ Scene JSON</button>
        </div>

        <ArchStudio worker={worker} bump={bump} onScan={(s) => { setScan(s); setMeas(measureFrom(s)); setWalk(false); }}
          onScanNote={(id, note) => setMeas((m) => m && { ...m, noteId: id, note })} onTeach={(t) => void teach(t)}
          lesson={lesson ? { building: lesson.building, text: lesson.chapters.map((c) => `${c.title}: ${c.text}`).join("\n") } : null} lessonKey={lesson ? lessonTag(lesson.building) : ""} />

        <div className="card space-y-1.5">
          <div className="muted text-[10px] uppercase tracking-widest">Parts · click one in 3D or here</div>
          <ul className="space-y-0.5">{scene.parts.map((p) => (
            <li key={p.id}><button className="chip w-full justify-between text-left" aria-pressed={p.id === sel} onClick={() => setSel(p.id)}>
              <span>{p.name}</span><span className="muted num">{p.w}×{p.d}×{p.h} m</span></button></li>))}</ul>
          {part && <div className="flex flex-wrap items-center gap-2 pt-1">
            {isOpening(part.kind) ? <>{field("w", "W")}{field("h", "H")}{field("off", "Off")}{part.kind === "window" && field("sill", "Sill")}
              <select className="field" value={part.face} aria-label={`${part.name} wall face`} onChange={(e) => apply([{ op: "set", id: part.id, face: e.target.value as "n" | "e" | "s" | "w" }])}>
                {(["n", "e", "s", "w"] as const).map((f) => <option key={f} value={f}>{{ n: "North", e: "East", s: "South", w: "West" }[f]} face</option>)}</select></>
              : <>{field("w", "W")}{field("d", "D")}{field("h", "H")}{field("x", "X")}{field("z", "Z")}</>}
            {host && <>
              <button className="chip" onClick={() => apply([{ op: "add", kind: "window", host: host.id, face: "s", w: 1.2 }])}>+ Window</button>
              <button className="chip" onClick={() => apply([{ op: "add", kind: "door", host: host.id, face: "s", w: 0.9 }])}>+ Door</button></>}
            <button className="chip error" onClick={() => { apply([{ op: "remove", id: part.id }]); setSel(null); }}>Remove</button>
            {host && <span className="muted text-[11px]">Windows and doors added here go on the south face; pick one to change face or offset.</span>}</div>}
        </div>

        <div className="card space-y-1">
          <div className="muted text-[10px] uppercase tracking-widest">Bill of quantities · from the geometry</div>
          <table className="w-full text-xs"><tbody>
            {cost.lines.map((l) => (
              <tr key={l.key} title={`${l.source}${l.date ? ` · ${l.date}` : ""}`}>
                <td>{l.label}</td><td className="num text-right">{l.qty} {l.unit}</td>
                <td className="num text-right"><input className="field w-16 text-right" type="number" step={0.5} value={l.eur} aria-label={`${l.label} price per ${l.unit}`}
                  onChange={(e) => { const v = Number(e.target.value); if (v >= 0) setPrices((ps) => ps.map((x) => (x.key === l.key ? { ...x, eur: v, source: "your edit", date: new Date().toISOString().slice(0, 10) } : x))); }} /> €/{l.unit}</td>
                <td className="num text-right">{eur(l.total)}</td>
              </tr>))}
            <tr className="font-semibold"><td colSpan={3}>Total (materials, VAT excl.)</td><td className="num text-right">{eur(cost.total)}</td></tr>
          </tbody></table>
          <p className="muted text-[11px]">{prices.some((p) => !p.date) ? "Some prices are unverified starter estimates. " : ""}Hover a row for its price source. Window and door areas are taken off the walls. Labour and transport aren&apos;t counted yet.</p>
        </div>

        {tips.length > 0 && <div className="card space-y-1"><div className="muted text-[10px] uppercase tracking-widest">Bulk buying</div>{tips.map((t) => <p key={t} className="text-xs">• {t}</p>)}</div>}
        <p className="muted text-[11px]">A study tool: rules of thumb (rebar ~100 kg/m³, 300 mm block walls). Anything you build for real needs an engineer&apos;s sign-off.</p>
      </section>

      {walk && !flat && <WalkPad />}
      <button className="chip world-back absolute bottom-28 right-3 z-[15] min-[900px]:bottom-24 min-[900px]:right-[32rem]" onClick={onClose}>← Back to galaxy</button>
    </div>
  );
}

/** Touch walking: hold an arrow to move (it presses the same keys Walker listens to); drag the view to look. */
function WalkPad() {
  const key = (k: string, type: "keydown" | "keyup") => dispatchEvent(new KeyboardEvent(type, { key: k }));
  const pad = (k: string, label: string, cls: string) => (
    <button className={`chip ${cls}`} aria-label={`Walk ${k.replace("Arrow", "").toLowerCase()}`} style={{ touchAction: "none" }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); key(k, "keydown"); }} onPointerUp={() => key(k, "keyup")} onPointerCancel={() => key(k, "keyup")}
      onContextMenu={(e) => e.preventDefault()}>{label}</button>
  );
  return (
    <div className="absolute bottom-40 left-4 z-[15] grid grid-cols-3 gap-1 select-none" aria-label="Walk controls">
      {pad("ArrowUp", "▲", "col-start-2")}{pad("ArrowLeft", "◀", "col-start-1")}{pad("ArrowDown", "▼", "")}{pad("ArrowRight", "▶", "")}
    </div>
  );
}

/** Type freely; applied on Enter or leaving the field, clamped to what the parser allows. One undo step per edit. */
function NumField({ label, name, value, pos, onCommit }: { label: string; name: string; value: number; pos: boolean; onCommit: (v: number) => void }) {
  const [txt, setTxt] = useState(String(value));
  const commit = () => {
    const v = Number(txt.replace(",", "."));
    if (txt.trim() === "" || !Number.isFinite(v)) return setTxt(String(value));
    const c = pos ? Math.max(-MAX.plot, Math.min(MAX.plot, v)) : Math.max(0.05, Math.min(MAX.size, v));
    if (c !== value) onCommit(c); else setTxt(String(value));
  };
  return (
    <label className="flex items-center gap-1 text-xs"><span className="muted w-4">{label}</span>
      <input className="field w-16" inputMode="decimal" value={txt} aria-label={`${name} ${label} in metres`} onChange={(e) => setTxt(e.target.value)}
        onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
    </label>
  );
}
