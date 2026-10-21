"use client";
// ARCH planet: a study workspace for small buildings. Blocks in metres on a plot; edit by typing to CORE or directly with the numbers.
// Quantities and euros are computed in arch-pure.ts from the geometry, never by the AI. Learning tool, not certification.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useGlRecovery } from "./useGlRecovery";
import { MAX, applyOps, boq, bulkTips, costLines, starterScene, STARTER_PRICES, type Op, type Part, type PriceItem, type Scene } from "@/lib/arch-pure";

const KEY = "orbit.arch.v1";
const COLOR: Record<Part["kind"], string> = { foundation: "#64748b", slab: "#94a3b8", wall: "#e2e8f0", roof: "#b45309" };
const GROUND: Record<Scene["plot"]["ground"], string> = { grass: "#2f5d34", gravel: "#6b6b6b", forest: "#1f3d24", sand: "#c2a46b" };
const load = (): { scene: Scene; prices: PriceItem[] } | null => { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const eur = (n: number) => n.toLocaleString("et-EE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
let seq = Date.now();
const newId = () => `p${(seq++).toString(36)}`;

/** One block that eases toward its target size/position each frame: edits glide instead of jumping. */
function Block({ p, selected, onPick, reduced }: { p: Part; selected: boolean; onPick: () => void; reduced: boolean }) {
  const m = useRef<THREE.Mesh>(null);
  const target = useMemo(() => ({ pos: new THREE.Vector3(p.x, p.y + p.h / 2, p.z), scale: new THREE.Vector3(p.w, p.h, p.d) }), [p.x, p.y, p.z, p.w, p.d, p.h]);
  const [start] = useState(() => ({ pos: target.pos.clone(), scale: target.scale.clone() })); // set once: later changes glide in useFrame
  useFrame((_, dt) => {
    if (!m.current) return;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 10);
    m.current.position.lerp(target.pos, k);
    m.current.scale.lerp(target.scale, k);
  });
  return (
    <mesh ref={m} position={start.pos} scale={start.scale} castShadow receiveShadow onClick={(e) => { e.stopPropagation(); onPick(); }}>
      {p.kind === "roof" ? <coneGeometry args={[0.72, 1, 4, 1]} /> : <boxGeometry args={[1, 1, 1]} />}
      <meshStandardMaterial color={COLOR[p.kind]} emissive={selected ? "#38bdf8" : "#000"} emissiveIntensity={selected ? 0.35 : 0} transparent={p.kind === "wall"} opacity={p.kind === "wall" ? 0.92 : 1} />
    </mesh>
  );
}

function Trees({ n, w, d }: { n: number; w: number; d: number }) {
  // deterministic spots along the plot edge, so trees don't jump around on every render
  const spots = useMemo(() => Array.from({ length: n }, (_, i) => { const t = (i * 0.618) % 1, side = i % 4, e = 0.45;
    return side === 0 ? [(t - 0.5) * w, -d * e] : side === 1 ? [(t - 0.5) * w, d * e] : side === 2 ? [-w * e, (t - 0.5) * d] : [w * e, (t - 0.5) * d]; }), [n, w, d]);
  return <>{spots.map(([x, z], i) => <mesh key={i} position={[x, 2, z]} castShadow><coneGeometry args={[1, 4, 7]} /><meshStandardMaterial color="#14532d" /></mesh>)}</>;
}

export default function ArchWorld({ onClose, reduced, flat }: { onClose: () => void; reduced: boolean; flat?: boolean }) {
  const glr = useGlRecovery();
  const [scene, setScene] = useState<Scene>(starterScene);
  const [prices, setPrices] = useState<PriceItem[]>(STARTER_PRICES);
  const [past, setPast] = useState<Scene[]>([]);
  const [sel, setSel] = useState<string | null>(null);
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
    <div role="region" className="absolute inset-0 globe-in" aria-label="ARCH: architecture study workspace" style={{ background: "#0a0f14" }}>
      {!flat && (
        <Canvas key={glr.key} onCreated={glr.onCreated} shadows camera={{ position: [18, 14, 18], fov: 45 }} onPointerMissed={() => setSel(null)}>
          <color attach="background" args={["#0a0f14"]} />
          <hemisphereLight args={["#cfe8ff", "#1b2a1b", 0.6]} />
          <directionalLight position={[15, 25, 10]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[scene.plot.w, scene.plot.d]} /><meshStandardMaterial color={GROUND[scene.plot.ground]} /></mesh>
          <gridHelper args={[Math.max(scene.plot.w, scene.plot.d), Math.max(scene.plot.w, scene.plot.d), "#38bdf8", "#1e3a4a"]} position={[0, 0.01, 0]} />
          <Trees n={scene.plot.trees} w={scene.plot.w} d={scene.plot.d} />
          {scene.parts.map((p) => <Block key={p.id} p={p} selected={p.id === sel} reduced={reduced} onPick={() => setSel(p.id)} />)}
          <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI / 2.05} />
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
