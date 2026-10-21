"use client";
// ARCH planet: a study workspace for small buildings. Blocks in metres on a plot; edit by typing to CORE or directly with the numbers.
// Quantities and euros are computed in arch-pure.ts from the geometry, never by the AI. Learning tool, not certification.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Edges, Line, OrbitControls } from "@react-three/drei";
import { useGlRecovery } from "./useGlRecovery";
import { MAX, applyOps, boq, bulkTips, costLines, starterScene, STARTER_PRICES, type Op, type Part, type PriceItem, type Scene } from "@/lib/arch-pure";

const KEY = "orbit.arch.v1";
// Architectural-model look: warm whites and stone, thin dark edges, a pale blueprint ground.
const COLOR: Record<Part["kind"], string> = { foundation: "#a8a29e", slab: "#d6d3d1", wall: "#f5f2ec", roof: "#e7e2d9" };
const GROUND: Record<Scene["plot"]["ground"], string> = { grass: "#c9d3bf", gravel: "#d9d6cf", forest: "#b9c6b0", sand: "#e6dcc6" };
const BG = "#ebe7e0", GOLD = "#c9a24a";
const TP = new THREE.Vector3(), TS = new THREE.Vector3(); // per-frame scratch
const STEP_S = 0.45; // build animation: one part every 0.45 s, bottom to top

/** Unit gable roof (1 × 1 × 1, ridge along x), so a roof part scales like a box but reads as a roof. A low roof (< 0.5 m) is flat. */
const GABLE = (() => {
  const sh = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
  g.translate(0, -0.5, -0.5); g.rotateY(Math.PI / 2); // centred like a unit box, ridge along x
  return g;
})();
const load = (): { scene: Scene; prices: PriceItem[] } | null => { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const eur = (n: number) => n.toLocaleString("et-EE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
let seq = Date.now();
const newId = () => `p${(seq++).toString(36)}`;

/** One block that eases toward its target size/position each frame: edits glide instead of jumping. */
function Block({ p, selected, onPick, reduced, appearAt, hidden }: { p: Part; selected: boolean; onPick: () => void; reduced: boolean; appearAt: number; hidden: boolean }) {
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
      <meshStandardMaterial color={COLOR[p.kind]} roughness={0.9} emissive={selected ? GOLD : "#000"} emissiveIntensity={selected ? 0.25 : 0} />
      <Edges threshold={20} color={selected ? GOLD : "#57534e"} />
    </mesh>
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
  return <>{parts.filter((p) => p.y <= 0.01).map((p) => {
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

export default function ArchWorld({ onClose, reduced, flat }: { onClose: () => void; reduced: boolean; flat?: boolean }) {
  const glr = useGlRecovery();
  const [scene, setScene] = useState<Scene>(starterScene);
  const [prices, setPrices] = useState<PriceItem[]>(STARTER_PRICES);
  const [past, setPast] = useState<Scene[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [run, setRun] = useState(0), [t0, setT0] = useState(0); // ▶ Build replays the assembly
  const [noRoof, setNoRoof] = useState(false), [spin, setSpin] = useState(false);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(false); // state, not a ref: the save effect must not run with the starter scene before the load lands
  useEffect(() => {
    const s = load();
    if (s?.scene?.parts) {
      setScene(s.scene);
      if (Array.isArray(s.prices)) setPrices(STARTER_PRICES.map((d) => { const x = s.prices.find((p) => p.key === d.key); return x && Number.isFinite(x.eur) ? { ...d, ...x } : d; }));
    }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) try { localStorage.setItem(KEY, JSON.stringify({ scene, prices })); } catch { /* private mode: the scene just isn't kept */ } }, [scene, prices, ready]);

  const sceneRef = useRef(scene);
  sceneRef.current = scene; // an AI reply applies to the scene as it is when it lands, not when it was asked
  const apply = (ops: Op[]) => { const cur = sceneRef.current, r = applyOps(cur, ops, newId); sceneRef.current = r.scene; setPast((p) => [...p.slice(-30), cur]); setScene(r.scene); return r.moved; };
  const undo = () => setPast((p) => { if (p.length) setScene(p[p.length - 1]); return p.slice(0, -1); });
  const q = boq(scene.parts), cost = costLines(q, prices), tips = bulkTips(q);
  const part = scene.parts.find((p) => p.id === sel);

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

  const field = (k: "w" | "d" | "h" | "x" | "z", label: string) => part && <NumField key={`${part.id}-${k}-${part[k]}`} label={label} name={part.name} value={part[k]} pos={k === "x" || k === "z"}
    onCommit={(v) => apply([{ op: "set", id: part.id, [k]: v }])} />;

  return (
    <div role="region" className="absolute inset-0 globe-in" aria-label="ARCH: architecture study workspace" style={{ background: BG }}>
      {!flat && (
        <Canvas key={glr.key} onCreated={glr.onCreated} shadows camera={{ position: [18, 14, 18], fov: 45 }} onPointerMissed={() => setSel(null)}>
          <color attach="background" args={[BG]} />
          <fog attach="fog" args={[BG, 60, 140]} />
          <hemisphereLight args={["#ffffff", "#d6cfc4", 0.9]} />
          <directionalLight position={[-14, 22, 12]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[scene.plot.w, scene.plot.d]} /><meshStandardMaterial color={GROUND[scene.plot.ground]} roughness={1} /></mesh>
          <gridHelper args={[Math.max(scene.plot.w, scene.plot.d), Math.max(scene.plot.w, scene.plot.d), "#cbbf9f", "#ddd6c6"]} position={[0, 0.005, 0]} />
          <ContactShadows position={[0, 0.01, 0]} scale={Math.max(scene.plot.w, scene.plot.d)} opacity={0.35} blur={2.5} far={12} />
          <Blueprint parts={scene.parts} />
          <Trees n={scene.plot.trees} w={scene.plot.w} d={scene.plot.d} />
          <BuildClock run={run} onStart={setT0} />
          {[...scene.parts].sort((a, b) => a.y - b.y).map((p, i) => <Block key={p.id} p={p} selected={p.id === sel} reduced={reduced} onPick={() => setSel(p.id)}
            appearAt={t0 + 0.6 + i * STEP_S} hidden={noRoof && p.kind === "roof"} />)}
          <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI / 2.05} autoRotate={spin && !reduced} autoRotateSpeed={0.8} />
        </Canvas>
      )}

      <section className="glass hud-panel world-panel panel-in absolute inset-x-3 bottom-32 z-[14] max-h-[45dvh] space-y-3 overflow-y-auto p-3 text-sm min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:right-3 min-[900px]:top-[4.5rem] min-[900px]:max-h-[calc(100dvh-11rem)] min-[900px]:w-[30rem]" aria-label="ARCH controls">
        <h2 className="brand text-base">ARCH</h2>
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input className="field flex-1" placeholder="Make the house 2 m longer · add a second floor · plot 40×30 with 12 trees" value={cmd} maxLength={500} onChange={(e) => setCmd(e.target.value)} aria-label="Tell CORE what to change" />
          <button className="btn" disabled={busy || !cmd.trim()}>{busy ? "Working…" : "Do it"}</button>
        </form>
        {msg && <p aria-live="polite">{msg}</p>}
        <div className="flex flex-wrap gap-1.5">
          <button className="chip" onClick={() => setRun((n) => n + 1)} title="Replay the assembly, bottom to top">▶ Build</button>
          <button className="chip" aria-pressed={noRoof} onClick={() => setNoRoof((v) => !v)}>Hide roof</button>
          <button className="chip" aria-pressed={spin} onClick={() => setSpin((v) => !v)}>Turntable</button>
          <button className="chip" disabled={!past.length} onClick={undo}>↶ Undo</button>
          <button className="chip" onClick={() => { setPast((p) => [...p, scene]); setScene(starterScene()); setSel(null); }}>Start over</button>
        </div>

        <div className="card space-y-1.5">
          <div className="muted text-[10px] uppercase tracking-widest">Parts · click one in 3D or here</div>
          <ul className="space-y-0.5">{scene.parts.map((p) => (
            <li key={p.id}><button className="chip w-full justify-between text-left" aria-pressed={p.id === sel} onClick={() => setSel(p.id)}>
              <span>{p.name}</span><span className="muted num">{p.w}×{p.d}×{p.h} m</span></button></li>))}</ul>
          {part && <div className="flex flex-wrap items-center gap-2 pt-1">{field("w", "W")}{field("d", "D")}{field("h", "H")}{field("x", "X")}{field("z", "Z")}
            <button className="chip error" onClick={() => { apply([{ op: "remove", id: part.id }]); setSel(null); }}>Remove</button></div>}
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
          <p className="muted text-[11px]">{prices.some((p) => !p.date) ? "Some prices are unverified starter estimates. " : ""}Hover a row for its price source. Labour, transport and openings aren&apos;t counted yet.</p>
        </div>

        {tips.length > 0 && <div className="card space-y-1"><div className="muted text-[10px] uppercase tracking-widest">Bulk buying</div>{tips.map((t) => <p key={t} className="text-xs">• {t}</p>)}</div>}
        <p className="muted text-[11px]">A study tool: rules of thumb (rebar ~100 kg/m³, 300 mm block walls). Anything you build for real needs an engineer&apos;s sign-off.</p>
      </section>

      <button className="chip world-back absolute bottom-28 right-3 z-[15] min-[900px]:bottom-24 min-[900px]:right-[32rem]" onClick={onClose}>← Back to galaxy</button>
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
