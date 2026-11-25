"use client";
// YouTube autopilot without vidIQ (STUDIO → Shorts → Autopilot): one input (the niche), then one "Working on it" card per video idea
// (the shared ProgressCard). Opening a card shows only what he needs to decide: why it worked, the script, the style frames or the
// motion test, and the one approve button of that step. Logic: lib/clips/explainer.ts. Nothing here posts or uploads.
import { useCallback, useEffect, useState } from "react";
import { ProgressCard } from "./ProgressCard";
import { useT } from "./i18n";
import type { Progress } from "@/lib/progress-pure";
import type { Idea } from "@/lib/clips/explainer-pure";

const URL_ = "/api/studio/yt-autopilot";
type Report = { niche: string; outliers: { id: string; title: string; channel: string; views: number; projected: number | null; url: string; why: { why: string; copy: string[] } }[]; sources: { name: string; ok: boolean; note: string }[] };
type View = { cards: Progress[]; ideas: Idea[]; report: Report | null; research: { running: boolean }; researchCard: Progress | null };

export default function StudioIdeas({ active }: { active: boolean }) {
  const { t } = useT();
  const [d, setD] = useState<View | null>(null);
  const [niche, setNiche] = useState("what if explainers");
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try { const r = await fetch(URL_, { cache: "no-store" }); if (r.ok) setD(await r.json()); } catch { /* next poll */ }
  }, []);
  const busy = !!d && (d.research.running || d.ideas.some((i) => i.working));
  useEffect(() => {
    if (!active) return;
    void load();
    const id = setInterval(() => void load(), busy ? 3000 : 20000);
    return () => clearInterval(id);
  }, [active, busy, load]);
  const post = async (body: Record<string, unknown>) => {
    setErr("");
    const r = await fetch(URL_, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Failed (${r.status})`);
    void load();
  };
  const idea = d?.ideas.find((i) => `idea:${i.id}` === open) ?? null;

  return (
    <section className="card space-y-2" aria-label={t("ya.title")}>
      <h3 className="font-medium">{t("ya.title")}</h3>
      <p className="muted text-xs">{t("ya.blurb")}</p>
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void post({ action: "research", niche }); }}>
        <input className="input flex-1" aria-label={t("ya.niche")} value={niche} maxLength={60} onChange={(e) => setNiche(e.target.value)} />
        <button className="btn" disabled={d?.research.running}>{t("ya.find")}</button>
      </form>
      {err && <p className="error text-xs" role="alert">{err}</p>}
      {d?.researchCard && <ProgressCard p={d.researchCard} onAction={() => void post({ action: "research", niche })} />}
      {d && !d.cards.length && !d.researchCard && <p className="muted text-xs">{t("ya.none")}</p>}
      {d?.cards.map((p) => (
        <div key={p.id}>
          <ProgressCard p={p} compact onOpen={() => setOpen(open === p.id ? null : p.id)} onAction={(a) => (a.kind === "retry" ? void post({ action: "retry", id: p.id.slice(5) }) : setOpen(p.id))} />
          {idea && open === p.id && <IdeaDetail i={idea} post={post} />}
        </div>
      ))}
      {d?.report && d.report.outliers.length > 0 && (
        <details className="text-xs">
          <summary>{t("ya.top")}: {d.report.niche}</summary>
          <ol className="mt-1 space-y-1.5">
            {d.report.outliers.map((o) => (
              <li key={o.id}><a className="link" href={o.url} target="_blank" rel="noopener noreferrer">{o.title}</a> · {o.channel} · {t("sid.views", { n: o.views.toLocaleString() })}{o.projected !== null && ` · ${t("sid.normal", { x: o.projected.toFixed(1) })}`}
                <div className="muted">{o.why.why}</div>{o.why.copy.length > 0 && <div>{t("ya.copy")}: {o.why.copy.join(" · ")}</div>}</li>
            ))}
          </ol>
          <p className="muted mt-1">{t("ya.sources")}: {d.report.sources.map((s) => `${s.ok ? "✓" : "✕"} ${s.name} (${s.note})`).join(" · ")}</p>
        </details>
      )}
    </section>
  );
}

function IdeaDetail({ i, post }: { i: Idea; post: (b: Record<string, unknown>) => Promise<void> }) {
  const { t } = useT();
  const file = (f: string) => `${URL_}?id=${encodeURIComponent(i.id)}&file=${f}&v=${encodeURIComponent(i.updatedAt)}`;
  const needStyle = !!i.styleFrames && !i.styleApprovedAt, needMotion = !!i.styleApprovedAt && !!i.motionTest && !i.motionApprovedAt;
  return (
    <div className="mt-1.5 space-y-2 rounded border border-white/10 p-2 text-xs">
      <p><b>{t("ya.why")}:</b> {i.why.why}</p>
      {i.angle && <p className="muted">{i.angle}</p>}
      {i.script.length > 0 && <details><summary>{t("ya.script")}</summary><ol className="mt-1 space-y-1">{i.script.map((b, k) => <li key={k}><span className="muted">{b.sec}s · {t("sid.seen")}</span> {b.seen} <br /><span className="muted">{t("sid.heard")}</span> “{b.heard}”</li>)}</ol></details>}
      {i.titles.length > 0 && <details><summary>{t("ya.options")}</summary>
        <ul className="mt-1 space-y-1">{i.titles.map((x, k) => <li key={k}>“{x.text}” <span className="muted">— {x.reason}</span></li>)}{i.thumbs.map((x, k) => <li key={`t${k}`}>🖼 {x.idea} <span className="muted">— {x.reason}</span></li>)}</ul>
        <p className="muted mt-1">{i.abNote}</p></details>}
      {needStyle && <div className="flex gap-1.5">{i.styleFrames!.files.map((_, k) => <img key={k} src={file(`style-${k + 1}`)} alt={t("sid.frame", { n: k + 1 })} className="h-40 rounded" />)}</div>}
      {needMotion && <video src={file("motion")} controls loop className="h-64 rounded" aria-label={t("sid.motion")} />}
      <div className="flex flex-wrap gap-1.5">
        {needStyle && <button className="btn" onClick={() => void post({ action: "approve-style", id: i.id })}>{t("ya.approveStyle")}</button>}
        {needMotion && <button className="btn" onClick={() => void post({ action: "approve-motion", id: i.id })}>{t("ya.approveMotion")}</button>}
        {i.motionApprovedAt && !i.handoff && <button className="btn" onClick={() => void post({ action: "handoff", id: i.id })}>{t("ya.handoff")}</button>}
        <button className="chip" disabled={!!i.working} onClick={() => void post({ action: "redo-script", id: i.id })}>{t("ya.redo")}</button>
        <button className="chip muted" onClick={() => void post({ action: "dismiss", id: i.id })}>{t("ya.dismiss")}</button>
      </div>
    </div>
  );
}
