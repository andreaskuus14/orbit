"use client";
// ARCH → Render in Blender (free, on this PC). Says in plain words whether Blender is there (with the one-line install when it
// isn't), two buttons (Preview ~1 min, Detail longer), progress on the shared "Working on it" card, and the picture from VAULT.
// Uses the sun date/hour set in ARCH. Renders the SAVED model (ARCH autosaves), so what you see is what was saved.
// Rules: lib/arch-render-pure.ts. The Blender scene is the same geometry as the preview (lib/arch-mesh-pure.ts).
import { useEffect, useRef, useState } from "react";
import { blenderStatusText, renderProgress, WINGET_BLENDER, type RenderJob } from "@/lib/arch-render-pure";
import { ProgressCard } from "./ProgressCard";
import { useT } from "./i18n";

const raw = (name: string) => `/api/vault?file=${encodeURIComponent(name)}&raw=1`;
type Blender = { found: boolean; how: string } | null;

export function ArchRender({ project, lat, lon, at }: { project: string | null; lat: number; lon: number; at?: string }) {
  const { t, lang } = useT();
  const [job, setJob] = useState<RenderJob | null>(null), [blender, setBlender] = useState<Blender>(null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [now, setNow] = useState(() => Date.now()), [copied, setCopied] = useState(false);
  const last = useRef<"preview" | "detail">("preview");
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const poll = async () => {
    const j = await fetch("/api/arch/render", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!live.current || !Array.isArray(j?.jobs)) return;
    const lastJob = (j.jobs as RenderJob[]).at(-1) ?? null;
    setJob(lastJob); setNow(Date.now());
    if (j.blender && typeof j.blender.found === "boolean") setBlender(j.blender);
    if (lastJob && lastJob.stage !== "done" && !lastJob.error) setTimeout(poll, 2000);
  };
  useEffect(() => { void poll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once: pick up a render already running

  const start = async (quality: "preview" | "detail") => {
    setBusy(true); setErr(""); last.current = quality;
    try {
      const q = project ? `?project=${encodeURIComponent(project)}` : "";
      const r = await fetch(`/api/arch/render${q}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quality, lat, lon, at }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setJob(j.job); setTimeout(poll, 1500);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const running = !!job && job.stage !== "done" && !job.error;
  const missing = blender?.found === false;
  const progress = job ? renderProgress(job, lang, now, job.saved ? raw(job.saved) : "") : null;
  const copy = () => { void navigator.clipboard?.writeText(WINGET_BLENDER).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => {}); };
  return (
    <div className="arch-render card w-full space-y-2" aria-label={t("arch.render")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <b className="mr-auto text-xs">🎨 {t("arch.render")}</b>
        <button className="btn px-3 py-1 text-xs" disabled={busy || running || missing} onClick={() => void start("preview")} title={t("arch.renderPreviewTitle")}>{t("arch.renderPreview")}</button>
        <button className="chip" disabled={busy || running || missing} onClick={() => void start("detail")} title={t("arch.renderDetailTitle")}>{t("arch.renderDetail")}</button>
      </div>
      <p className={`text-[11px]${missing ? "" : " muted"}`} role="status">{blender?.found ? "✓ " : missing ? "✕ " : ""}{blenderStatusText(blender, lang)}</p>
      {missing && <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <code className="rounded bg-black/30 px-1.5 py-0.5">{WINGET_BLENDER}</code>
        <button className="chip" onClick={copy}>{copied ? t("arch.renderCopied") : t("arch.renderCopy")}</button>
        <button className="chip" onClick={() => void poll()}>{t("arch.renderRecheck")}</button>
      </div>}
      {progress && (running || job?.error || job?.stage === "done") && <ProgressCard p={progress} onAction={(a) => (a.kind === "retry" ? void start(last.current) : window.open(a.open, "_blank", "noopener"))} />}
      {err && <p className="error text-xs" role="alert">{err}</p>}
      {job?.stage === "done" && job.saved && (
        <a href={raw(job.saved)} target="_blank" rel="noreferrer"><img src={raw(job.saved)} alt={t("arch.renderAlt")} className="arch-render-img w-full rounded-lg" /></a>
      )}
      {!job && !missing && <p className="muted text-[11px]">{t("arch.renderHint")}</p>}
    </div>
  );
}
