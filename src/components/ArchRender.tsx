"use client";
// ARCH → Render in Blender (free, on this PC). Two buttons (Preview ~1 min, Detail longer), then the shared progress look and the
// picture from VAULT. Uses the sun date/hour set in ARCH. Renders the SAVED model (ARCH autosaves), so what you see is what was saved. Rules: lib/arch-render-pure.ts.
import { useEffect, useRef, useState } from "react";
import { STAGE_TEXT, type RenderJob } from "@/lib/arch-render-pure";

const ORDER = ["script", "gpu", "render", "save"] as const;
const raw = (name: string) => `/api/vault?file=${encodeURIComponent(name)}&raw=1`;

export function ArchRender({ project, lat, lon, at }: { project: string | null; lat: number; lon: number; at?: string }) {
  const [job, setJob] = useState<RenderJob | null>(null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const poll = async () => {
    const j = await fetch("/api/arch/render", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!live.current || !Array.isArray(j?.jobs)) return;
    const last = (j.jobs as RenderJob[]).at(-1) ?? null;
    setJob(last);
    if (last && last.stage !== "done" && !last.error) setTimeout(poll, 2000);
  };
  useEffect(() => { void poll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once: pick up a render already running

  const start = async (quality: "preview" | "detail") => {
    setBusy(true); setErr("");
    try {
      const q = project ? `?project=${encodeURIComponent(project)}` : "";
      const r = await fetch(`/api/arch/render${q}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quality, lat, lon, at }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setJob(j.job); setTimeout(poll, 1500);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const running = !!job && job.stage !== "done" && !job.error;
  const step = job ? ORDER.indexOf(job.stage as (typeof ORDER)[number]) : -1;
  return (
    <div className="arch-render card w-full space-y-2" aria-label="Render in Blender">
      <div className="flex flex-wrap items-center gap-1.5">
        <b className="mr-auto text-xs">🎨 Render in Blender</b>
        <button className="chip" disabled={busy || running} onClick={() => void start("preview")}>Preview</button>
        <button className="chip" disabled={busy || running} onClick={() => void start("detail")}>Detail</button>
      </div>
      {running && job && (
        <div className="progress-card" data-phase="working" role="status">
          <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {ORDER.map((s, i) => <li key={s} className={i < step ? "muted" : i === step ? "" : "muted opacity-50"}>{i < step ? "✓" : i === step ? "●" : "○"} {STAGE_TEXT[s]}</li>)}
          </ol>
          {job.wait && <p className="muted text-xs">{job.wait}</p>}
        </div>
      )}
      {job?.error && <p className="error text-xs" role="alert">{job.error}</p>}
      {err && <p className="error text-xs" role="alert">{err}</p>}
      {job?.stage === "done" && job.saved && (
        <figure className="space-y-1">
          <a href={raw(job.saved)} target="_blank" rel="noreferrer"><img src={raw(job.saved)} alt="Blender render of the house" className="arch-render-img w-full rounded-lg" /></a>
          <figcaption className="muted text-[11px]">Saved to VAULT as {job.saved}{job.seconds ? ` · ${job.seconds} s` : ""}</figcaption>
        </figure>
      )}
      {!job && <p className="muted text-[11px]">Renders the saved house with real sunlight, free, on this PC. Pictures go to VAULT.</p>}
    </div>
  );
}
