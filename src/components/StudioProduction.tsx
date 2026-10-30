"use client";
// STUDIO production workspace (STU01-04): Ideas, Production, Review, Calendar, Results over one record per clip (production-pure.ts).
// Approving and publishing stay in the Clip Factory clip card (the owner's click on the exact revision); this view never uploads.
import { useCallback, useEffect, useState } from "react";
import WorkspaceFrame, { useWorkspaceView, type View } from "./WorkspaceFrame";
import ShortsBoard from "./ShortsBoard";
import StudioCalendar from "./StudioCalendar";
import { useT } from "./i18n";
import { RIGHTS_BASES, type ProdRecord as Rec, type RightsBasis } from "@/lib/clips/production-pure";
import type { ClipJob } from "@/lib/clips/types";

type V = "ideas" | "production" | "review" | "calendar" | "results";
const API = "/api/studio/production";
async function call<T>(method: string, body?: unknown): Promise<T> {
  const r = await fetch(API, { method, cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}

export default function StudioProduction({ reduced, review, onReview, onOpenClips }: { reduced: boolean; review: string | null; onReview: (id: string | null) => void; onOpenClips: () => void }) {
  const { t } = useT();
  const views: View<V>[] = [{ id: "ideas", label: t("sp.v.ideas") }, { id: "production", label: t("sp.v.production") }, { id: "review", label: t("sp.v.review") },
    { id: "calendar", label: t("sp.v.calendar") }, { id: "results", label: t("sp.v.results") }];
  const [view, setView] = useWorkspaceView<V>("studio", views);
  const [data, setData] = useState<{ records: Rec[]; jobs: ClipJob[] } | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => call<{ records: Rec[]; jobs: ClipJob[] }>("GET").then((d) => { setData(d); setErr(""); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (review) setView("review"); }, [review]); // eslint-disable-line react-hooks/exhaustive-deps -- a link opens its record
  const open = (id: string) => { onReview(id); setView("review"); };
  const rec = data?.records.find((r) => r.id === review) ?? null;
  const ready = data?.records.filter((r) => !r.blockers.length && !r.publication).length ?? 0;

  return (
    <section className="glass hud-panel h-full overflow-y-auto p-4" aria-label={t("sp.title")}>
      <WorkspaceFrame planet="studio" title={t("sp.title")} context={data ? t("sp.context", { n: data.records.length, ready }) : undefined}
        action={<button className="chip" onClick={onOpenClips}>{t("sp.openClips")}</button>} views={views} view={view} onView={setView}>
        {err && <p className="error" role="alert">{err}</p>}
        {!data && !err && <p className="muted">{t("sp.loading")}</p>}
        {data && view === "ideas" && <ShortsBoard jobs={data.jobs} active reduced={reduced} onOpen={onOpenClips}
          onPickTitle={async () => { onOpenClips(); return false; }} onMoreTitles={async () => { onOpenClips(); return false; }} />}
        {data && view === "production" && <RecordList records={data.records.filter((r) => !r.result)} onOpen={open} empty={t("sp.none")} />}
        {data && view === "review" && (rec ? <ReviewCard rec={rec} onChanged={load} onBack={() => onReview(null)} onOpenClips={onOpenClips} />
          : <><p className="muted">{review ? t("sp.notFound") : t("sp.pick")}</p><RecordList records={data.records.filter((r) => r.review.status === "ready" || r.review.status === "approved")} onOpen={open} empty={t("sp.none")} /></>)}
        {data && view === "calendar" && <StudioCalendar jobs={data.jobs} waiting={data.records.filter((r) => r.review.status === "approved" && !r.publication).length} scheduleAll={null}
          onOpen={(job, clip) => open(`${job}:${clip}`)} />}
        {data && view === "results" && <RecordList records={data.records.filter((r) => r.result)} onOpen={open} empty={t("sp.noResults")} />}
      </WorkspaceFrame>
    </section>
  );
}

function RecordList({ records, onOpen, empty }: { records: Rec[]; onOpen: (id: string) => void; empty: string }) {
  const { t } = useT();
  if (!records.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="space-y-1">
      {records.map((r) => (
        <li key={r.id}><button className="hud-row w-full text-left" style={{ gridTemplateColumns: "1fr auto" }} onClick={() => onOpen(r.id)}>
          <span className="truncate">{r.title}<span className="muted block truncate text-[11px]">{r.source.name}</span></span>
          <span className="text-[11px]">{r.result ? t("sp.live") : r.blockers.length ? t("sp.blocked", { n: r.blockers.length }) : t("sp.ready")}</span>
        </button></li>
      ))}
    </ul>
  );
}

function ReviewCard({ rec, onChanged, onBack, onOpenClips }: { rec: Rec; onChanged: () => Promise<void>; onBack: () => void; onOpenClips: () => void }) {
  const { t } = useT();
  const [basis, setBasis] = useState<RightsBasis>(rec.source.rights?.basis ?? "licensed");
  const [evidence, setEvidence] = useState(rec.source.rights?.evidence ?? "");
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  const run = async (k: string, f: () => Promise<unknown>) => { setBusy(k); setMsg(""); try { await f(); await onChanged(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(""); } };
  const qc = rec.review.check;
  return (
    <article className="space-y-3" aria-label={rec.title}>
      <div className="flex items-start justify-between gap-2"><b>{rec.title}</b><button className="chip" onClick={onBack} aria-label={t("sp.close")}>×</button></div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="muted">{t("sp.idea")}</dt><dd>{rec.idea ?? "–"}</dd>
        <dt className="muted">{t("sp.script")}</dt><dd>{rec.script?.title ?? "–"}</dd>
        <dt className="muted">{t("sp.source")}</dt><dd className="break-all">{rec.source.name}</dd>
        <dt className="muted">{t("sp.revisions")}</dt><dd>{rec.revisions.map((r) => `${r.clip} (${r.status})`).join(" · ")}</dd>
        <dt className="muted">{t("sp.approval")}</dt><dd>{rec.review.approved ? t("sp.approvedExact") : t("sp.notApproved")}</dd>
        <dt className="muted">{t("sp.publication")}</dt><dd>{rec.publication ? rec.publication.status : "–"}{rec.result && <> · <a href={rec.result.url} target="_blank" rel="noreferrer">YouTube ↗</a></>}</dd>
      </dl>

      {!rec.source.own && (
        <form className="space-y-1.5 rounded-md border border-white/10 p-2" aria-label={t("sp.rights")} onSubmit={(e) => { e.preventDefault(); void run("rights", () => call("PATCH", { job: rec.job, rights: { basis, evidence } })); }}>
          <b className="text-[12px]">{t("sp.rights")}</b>
          <p className="muted text-[11px]">{t("sp.rightsHint")}</p>
          {rec.source.note && <p className="muted text-[11px]">{t("sp.oldNote", { note: rec.source.note })}</p>}
          <label className="block text-[12px]">{t("sp.basis")} <select className="field" value={basis} onChange={(e) => setBasis(e.target.value as RightsBasis)}>
            {RIGHTS_BASES.map((b) => <option key={b} value={b}>{t(`sp.basis.${b}` as const)}</option>)}</select></label>
          <label className="block text-[12px]">{t("sp.evidence")}<textarea className="field w-full" rows={2} maxLength={300} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
          <button className="chip" disabled={!!busy}>{busy === "rights" ? t("sp.saving") : t("sp.saveRights")}</button>
        </form>
      )}

      <div className="space-y-1 rounded-md border border-white/10 p-2 text-[12px]">
        <div className="flex items-center justify-between gap-2"><b>{t("sp.media")}</b>
          <button className="chip" disabled={!!busy} onClick={() => void run("qc", () => call("POST", { job: rec.job, clip: rec.clip }))}>{busy === "qc" ? t("sp.checking") : t("sp.runCheck")}</button></div>
        {!qc ? <p className="muted">{t("sp.noCheck")}</p> : <>
          <p>{qc.pass ? t("sp.techPass") : t("sp.techFail")}</p>
          <p className="muted">{[qc.facts.duration !== undefined && `${qc.facts.duration.toFixed(1)} s`, qc.facts.width && `${qc.facts.width}×${qc.facts.height}`, qc.facts.audio ? `${t("sp.audio")} ${qc.facts.meanDb ?? "?"} dB` : t("sp.noAudio")].filter(Boolean).join(" · ")}</p>
          {[...qc.blocking.map((x) => `⛔ ${x}`), ...qc.warnings.map((x) => `⚠ ${x}`), ...qc.unchecked.map((x) => `👁 ${x}`)].map((x) => <p key={x}>{x}</p>)}
          {qc.evidence.length > 0 && <details><summary className="muted">{t("sp.evidenceLog")}</summary><ul className="muted text-[11px]">{qc.evidence.map((x) => <li key={x}>{x}</li>)}</ul></details>}
          <p className="muted text-[11px]">{t("sp.techNote")}</p>
        </>}
      </div>

      <div className="rounded-md border border-white/10 p-2 text-[12px]" aria-live="polite">
        {rec.blockers.length ? <><b>{t("sp.notReady")}</b><ul className="list-disc pl-4">{rec.blockers.map((b) => <li key={b}>{b}</li>)}</ul></>
          : <p>{t("sp.readyNote")}</p>}
        <button className="chip mt-1" onClick={onOpenClips}>{t("sp.openClips")}</button>
      </div>
      {msg && <p className="error" role="alert">{msg}</p>}
    </article>
  );
}
