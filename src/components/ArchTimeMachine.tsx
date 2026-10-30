"use client";
// ARCH time machine: scrub the model's saved versions (kept in the data dir by /api/arch/versions) and restore one,
// plus the sun study's shadow marker in the 3D view. Math in arch-time-pure.ts.
import { useEffect, useRef, useState } from "react";
import { Line } from "@react-three/drei";
import { shadowOf, type Snapshot } from "@/lib/arch-time-pure";
import type { Scene } from "@/lib/arch-pure";

const SAVE_AFTER_MS = 4000; // a burst of edits becomes one version

/** History panel. `save` false (a lesson is open) = don't record; onPreview(null) = back to the live model. */
export function ArchTimeMachine({ scene, save, onPreview, onRestore }: { scene: Scene; save: boolean; onPreview: (s: Scene | null) => void; onRestore: (s: Scene) => void }) {
  const [versions, setVersions] = useState<Snapshot[]>([]);
  const [i, setI] = useState<number | null>(null); // null = live model
  const [err, setErr] = useState("");
  const opened = useRef<string | null>(null); // the scene as ARCH opened: a version is only recorded once it changes
  useEffect(() => { fetch("/api/arch/versions").then((r) => r.json()).then((j) => Array.isArray(j.versions) && setVersions(j.versions)).catch(() => setErr("History unavailable")); }, []);
  useEffect(() => {
    if (!save || i !== null) return;
    const now = JSON.stringify(scene);
    if (opened.current === null) opened.current = now;
    const t = setTimeout(() => {
      if (now === opened.current) return; // opened, no edit (or edited back): nothing to record
      opened.current = now;
      fetch("/api/arch/versions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scene }) })
        .then((r) => r.json()).then((j) => { if (Array.isArray(j.versions)) { setVersions(j.versions); setErr(""); } else setErr(j.error ?? "Couldn't save the version"); })
        .catch(() => setErr("Couldn't save the version"));
    }, SAVE_AFTER_MS);
    return () => clearTimeout(t);
  }, [scene, save, i]);
  const pick = (n: number | null) => { setI(n); onPreview(n === null ? null : versions[n].scene); };
  const v = i === null ? null : versions[i];
  return (
    <div className="card space-y-1.5" aria-label="Version history">
      <div className="muted text-[10px] uppercase tracking-widest">Time machine · {versions.length} saved version{versions.length === 1 ? "" : "s"}</div>
      {versions.length ? <>
        <label className="flex items-center gap-2 text-xs">
          <span className="num w-28">{v ? new Date(v.at).toLocaleString("et-EE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Now (live)"}</span>
          <input className="flex-1" type="range" min={0} max={versions.length} step={1} value={i ?? versions.length} aria-label="Scrub version history"
            onChange={(e) => { const n = Number(e.target.value); pick(n >= versions.length ? null : n); }} /></label>
        <div className="flex flex-wrap gap-1.5">
          <button className="chip" disabled={i === 0} onClick={() => pick(Math.max(0, (i ?? versions.length) - 1))}>← Older</button>
          <button className="chip" disabled={i === null} onClick={() => pick(i! + 1 >= versions.length ? null : i! + 1)}>Newer →</button>
          {v && <button className="chip" onClick={() => { onRestore(v.scene); pick(null); }} title="Make this version the live model (Undo brings the current one back)">Restore this version</button>}
          {v && <button className="chip" onClick={() => pick(null)}>Back to now</button>}
        </div>
        {v && <p className="muted text-[11px]" aria-live="polite">Viewing version {i! + 1} of {versions.length}: {v.scene.parts.length} parts, plot {v.scene.plot.w}×{v.scene.plot.d} m. The 3D view shows this version; the parts list and costs stay on the live model.</p>}
      </> : <p className="muted text-xs">Every change is saved here a few seconds after you stop editing (last 60 kept on this PC).</p>}
      {err && <p className="muted text-[11px]" aria-live="polite">{err}</p>}
    </div>
  );
}

/** Ground shadow of the model's highest point: a post at the footprint centre and its shadow line, from the sun study. */
export function SunShadow({ scene, sun }: { scene: Scene; sun: { azimuthDeg: number; elevationDeg: number } }) {
  const solid = scene.parts.filter((p) => p.kind !== "window" && p.kind !== "door");
  if (!solid.length) return null;
  const topP = solid.reduce((m, p) => (p.y + p.h > m.y + m.h ? p : m));
  const h = topP.y + topP.h, s = shadowOf(sun, h, 120);
  if (!s) return null;
  return <>
    <Line points={[[topP.x, 0.03, topP.z], [topP.x, h, topP.z]]} color="#c2410c" lineWidth={1.5} dashed dashSize={0.3} gapSize={0.2} />
    <Line points={[[topP.x, 0.03, topP.z], [topP.x + s.dx, 0.03, topP.z + s.dz]]} color="#c2410c" lineWidth={3} />
  </>;
}
