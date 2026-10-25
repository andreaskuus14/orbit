"use client";
// ARCH measure inside a scan (roadmap 5.5): two clicks on the splat cloud → a dimension line. Picking runs in the splat worker
// (arch-measure-pure pickSplat), so a click never stalls a frame. Calibrate once on a known length (a door = 2.0 m); the scale
// and the measurements are kept in the scan's MEMORY note, in scan coordinates.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { calibrate, dist, formatLength, mid, parseLength, pickK, readMeasureNote, withMeasures, type MeasureNote, type V3 } from "@/lib/arch-measure-pure";
import type { ScanData, SplatWorker } from "./SplatCloud";

export type MeasureState = MeasureNote & { on: boolean; pending: V3 | null; noteId: string | null; note: string };
export const measureFrom = (s: ScanData): MeasureState => ({ ...readMeasureNote(s.note ?? ""), on: false, pending: null, noteId: s.noteId ?? null, note: s.note ?? "" });
type SetM = Dispatch<SetStateAction<MeasureState | null>>;

const C = "#fbbf24";
const label = (m: MeasureState, a: V3, b: V3) => `${m.scale ? "" : "≈"}${formatLength(dist(a, b) * (m.scale ?? 1))}`;
const RC = new THREE.Raycaster(), NDC = new THREE.Vector2(), INV = new THREE.Matrix4();

/** In the canvas, inside SplatCloud (scan coordinates): click picking while measuring, and the dimension lines. */
export function MeasureLayer({ m, set, worker, ext }: { m: MeasureState; set: SetM; worker: SplatWorker; ext: number }) {
  const { camera, gl } = useThree();
  const g = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!m.on) return;
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const pu = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || !g.current) return; // a drag orbits, it doesn't measure
      down = null;
      const r = el.getBoundingClientRect();
      RC.setFromCamera(NDC.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      INV.copy(g.current.matrixWorld).invert(); // world → scan coordinates (rigid: centring + flip)
      const o = RC.ray.origin.applyMatrix4(INV), d = RC.ray.direction.transformDirection(INV);
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 45;
      void worker.call({ pick: { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], k: pickK(fov, r.height, 10) } }).then((res) => {
        const hit = res.hit;
        if (hit) set((s) => s && (s.pending ? { ...s, pending: null, list: [...s.list, { a: s.pending, b: hit }] } : { ...s, pending: hit }));
      }, () => {});
    };
    el.addEventListener("pointerdown", pd); el.addEventListener("pointerup", pu);
    return () => { el.removeEventListener("pointerdown", pd); el.removeEventListener("pointerup", pu); };
  }, [m.on, camera, gl, worker, set]);

  const r = ext * 0.004;
  const dot = (p: V3, k: string) => <mesh key={k} position={p} renderOrder={11}><sphereGeometry args={[r, 10, 8]} /><meshBasicMaterial color={C} depthTest={false} /></mesh>;
  return (
    <group ref={g}>
      {m.list.map((x, i) => <group key={i}>
        <Line points={[x.a, x.b]} color={C} lineWidth={2} depthTest={false} renderOrder={10} />
        {dot(x.a, "a")}{dot(x.b, "b")}
        <Html position={mid(x.a, x.b)} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <span className="chip num whitespace-nowrap text-[11px]" style={{ borderColor: C }}>{i + 1} · {label(m, x.a, x.b)}</span>
        </Html>
      </group>)}
      {m.pending && dot(m.pending, "pending")}
    </group>
  );
}

/** In the ARCH panel: measure toggle, list with delete, calibrate on one measurement, save to the scan note. */
export function MeasurePanel({ m, set, onSaved }: { m: MeasureState; set: SetM; onSaved: () => void }) {
  const [cal, setCal] = useState<number | null>(null), [real, setReal] = useState("2.0"), [msg, setMsg] = useState("");
  async function save(next: MeasureState) {
    if (!next.noteId) return setMsg("This scan has no MEMORY note to save to; re-import it to get one.");
    setMsg("Saving…");
    const content = withMeasures(next.note, next);
    const r = await fetch(`/api/memories/${next.noteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }).catch(() => null);
    if (!r?.ok) return setMsg("Couldn't save to the scan note.");
    set((s) => s && { ...s, note: content });
    setMsg("Saved to the scan note."); onSaved();
  }
  function applyCal(i: number) {
    const x = m.list[i], v = parseLength(real), s = x && v !== null ? calibrate(dist(x.a, x.b), v) : null;
    if (!s || v === null) return setMsg("Type the real length, e.g. 2.0 or 200 cm.");
    const next = { ...m, scale: s, ref: v };
    set(next); setCal(null); void save(next); // calibration is once per scan: keep it right away
  }
  return (
    <div className="space-y-1.5" aria-label="Measure">
      <div className="flex flex-wrap gap-1.5">
        <button className="chip" aria-pressed={m.on} onClick={() => set((s) => s && { ...s, on: !s.on, pending: null })} title="Click two points on the scan">📏 Measure</button>
        {m.list.length > 0 && <button className="chip" onClick={() => void save(m)}>Save to scan note</button>}
      </div>
      {m.on && <p className="muted text-[11px]" aria-live="polite">{m.pending ? "Now click the second point." : "Click two points on the scan (drag still orbits)."}{!m.scale && " Calibrate first: measure something you know, like a door (2.0 m)."}</p>}
      <p className="muted text-[11px]">{m.scale ? `Calibrated${m.ref ? ` on ${formatLength(m.ref)}` : ""}: 1 scan unit = ${m.scale.toPrecision(4)} m.` : "Not calibrated: lengths assume the scan is in metres (≈)."}</p>
      {m.list.length > 0 && <ul className="space-y-0.5">{m.list.map((x, i) => <li key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="num w-20">{i + 1} · {label(m, x.a, x.b)}</span>
        {cal === i ? <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); applyCal(i); }}>
          <input className="field w-20" value={real} maxLength={12} onChange={(e) => setReal(e.target.value)} aria-label={`Real length of measurement ${i + 1}`} autoFocus />
          <button className="chip">Set</button><button type="button" className="chip" onClick={() => setCal(null)}>Cancel</button>
        </form> : <button className="chip" onClick={() => setCal(i)} title="Tell ORBIT the real length of this one; every length rescales">Calibrate…</button>}
        <button className="chip error" aria-label={`Delete measurement ${i + 1}`} onClick={() => { set((s) => s && { ...s, list: s.list.filter((_, j) => j !== i) }); setCal(null); }}>×</button>
      </li>)}</ul>}
      {msg && <p className="text-xs" aria-live="polite">{msg}</p>}
    </div>
  );
}
