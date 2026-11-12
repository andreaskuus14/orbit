"use client";
// STUDIO production workspace (STU01-08): Ideas, Production, Review, Edit, Calendar (+ capacity), Results over one record per clip (production-pure.ts).
// Approving and publishing stay in the Clip Factory clip card (the owner's click on the exact revision); this view never uploads.
import { useCallback, useEffect, useState } from "react";
import StateNote from "./StateNote";
import WorkspaceFrame, { useWorkspaceView, type View } from "./WorkspaceFrame";
import ShortsBoard from "./ShortsBoard";
import StudioCalendar from "./StudioCalendar";
import { VersionBox, type VersionForm } from "./ClipFactory";
import { useT } from "./i18n";
import { RIGHTS_BASES, type ProdRecord as Rec, type RightsBasis } from "@/lib/clips/production-pure";
import type { ClipJob, VersionEdit } from "@/lib/clips/types";
import type { Capacity, Outcome } from "@/lib/clips/depth-pure";
import { editChanges, paramHistory, renderEstimate, trimPreview } from "@/lib/clips/edit-pure";
import { mmss } from "@/lib/clips/format";
import { Captions, Voiceover } from "./LocalAi";
import { ProjectDesk } from "./ProjectDesk";
import StudioTrack from "./StudioTrack";

type V = "ideas" | "production" | "review" | "edit" | "calendar" | "results" | "voice" | "captions" | "projects" | "track";
type Data = { records: Rec[]; jobs: ClipJob[]; live: string[]; outcomes: Record<string, Outcome>; capacity: Capacity; bases: Record<string, VersionEdit> };
const media = (p: string) => `/api/studio/clips/media?f=${encodeURIComponent(p)}`;
const API = "/api/studio/production";
async function call<T>(method: string, body?: unknown): Promise<T> {
  const r = await fetch(API, { method, cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}

export default function StudioProduction({ reduced, review, onReview, onOpenClips }: { reduced: boolean; review: string | null; onReview: (id: string | null) => void; onOpenClips: () => void }) {
  const { t } = useT();
  const views: View<V>[] = [{ id: "ideas", label: t("sp.v.ideas") }, { id: "production", label: t("sp.v.production") }, { id: "review", label: t("sp.v.review") }, { id: "edit", label: t("sp.v.edit") },
    { id: "calendar", label: t("sp.v.calendar") }, { id: "results", label: t("sp.v.results") }, { id: "voice", label: "🎙 Voiceover" }, { id: "captions", label: "💬 Captions" }, { id: "projects", label: t("desk.projects") }, { id: "track", label: "🎬 Production track" }];
  const [view, setView] = useWorkspaceView<V>("studio", views);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [project, setProject] = useState("");
  const load = useCallback(() => call<Data>("GET").then((d) => { setData(d); setErr(""); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (review && view !== "edit") setView("review"); }, [review]); // eslint-disable-line react-hooks/exhaustive-deps -- a link opens its record
  const open = (id: string) => { onReview(id); setView("review"); };
  const rec = data?.records.find((r) => r.id === review) ?? null;
  const ready = data?.records.filter((r) => !r.blockers.length && !r.publication).length ?? 0;

  return (
    <section className="glass hud-panel h-full overflow-y-auto p-4" aria-label={t("sp.title")}>
      <WorkspaceFrame planet="studio" title={t("sp.title")} context={data ? t("sp.context", { n: data.records.length, ready }) : undefined}
        action={<button className="chip" onClick={onOpenClips}>{t("sp.openClips")}</button>} views={views} view={view} onView={setView}>
        {err ? <StateNote state="failed" what={err} kept={data ? t("state.keptScreen") : undefined} action={{ label: t("state.retry"), run: () => void load() }} />
        : !data && <StateNote state="loading" action={{ label: t("state.retry"), run: () => void load() }}>{t("sp.loading")}</StateNote>}
        {view === "voice" && <Voiceover />}
        {view === "track" && <StudioTrack />}
        {view === "captions" && <Captions />}
        {view === "projects" && <ProjectDesk key={project || "unassigned"} project={project} onSelect={setProject} mode="studio" productions={data?.records} />}
        {data && view === "ideas" && <ShortsBoard jobs={data.jobs} active reduced={reduced} onOpen={onOpenClips}
          onPickTitle={async () => { onOpenClips(); return false; }} onMoreTitles={async () => { onOpenClips(); return false; }} />}
        {data && view === "production" && <RecordList records={data.records.filter((r) => !r.result)} onOpen={open} empty={t("sp.none")} />}
        {data && view === "review" && (rec ? <ReviewCard rec={rec} outcome={data.outcomes[rec.id]} onChanged={load} onBack={() => onReview(null)} onOpenClips={onOpenClips} />
          : <><p className="muted">{review ? t("sp.notFound") : t("sp.pick")}</p><RecordList records={data.records.filter((r) => r.review.status === "ready" || r.review.status === "approved")} onOpen={open} empty={t("sp.none")} /></>)}
        {data && view === "edit" && (rec && data.bases[rec.job] ? <EditWorkspace key={rec.id} rec={rec} records={data.records} job={data.jobs.find((j) => j.id === rec.job)!}
          base={data.bases[rec.job]} onPick={onReview} onChanged={load} />
          : <><p className="muted">{t("se.pick")}</p><RecordList records={data.records.filter((r) => r.revisions.some((x) => x.video))} onOpen={onReview} empty={t("sp.none")} /></>)}
        {data && view === "calendar" && <CapacityPanel c={data.capacity} records={data.records} onOpen={open} />}
        {data && view === "calendar" && <StudioCalendar live={data.live} jobs={data.jobs} waiting={data.records.filter((r) => r.review.status === "approved" && !r.publication).length} scheduleAll={null}
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

function ReviewCard({ rec, outcome, onChanged, onBack, onOpenClips }: { rec: Rec; outcome?: Outcome; onChanged: () => Promise<void>; onBack: () => void; onOpenClips: () => void }) {
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

      {outcome && <OutcomeBox o={outcome} />}
      <div className="rounded-md border border-white/10 p-2 text-[12px]" aria-live="polite">
        {rec.blockers.length ? <><b>{t("sp.notReady")}</b><ul className="list-disc pl-4">{rec.blockers.map((b) => <li key={b}>{b}</li>)}</ul></>
          : <p>{t("sp.readyNote")}</p>}
        <button className="chip mt-1" onClick={onOpenClips}>{t("sp.openClips")}</button>
      </div>
      {msg && <p className="error" role="alert">{msg}</p>}
    </article>
  );
}

/** STU06: what the published revision did, joined by video id and the uploaded file's hash; dated readings and the limits named. */
function OutcomeBox({ o }: { o: Outcome }) {
  const { t } = useT();
  return (
    <section className="space-y-1 rounded-md border border-white/10 p-2 text-[12px]" aria-label={t("so.title")}>
      <b>{t("so.title")}</b>
      <p className="muted">{t(o.exact ? "so.exact" : "so.notExact", { video: o.videoId, rev: o.revision })}</p>
      {o.readings.length > 0 && <table className="w-full text-[11px]">
        <thead className="muted"><tr><th className="text-left">{t("so.when")}</th><th className="text-left">{t("so.date")}</th><th className="text-right">{t("so.views")}</th>
          <th className="text-right">{t("so.retention")}</th><th className="text-right">{t("so.watch")}</th></tr></thead>
        <tbody>{o.readings.map((r) => <tr key={r.snap}><td>{r.snap}</td><td className="num">{r.at.slice(0, 16).replace("T", " ")}</td><td className="num text-right">{r.views}</td>
          <td className="num text-right">{r.avgViewPct === undefined ? "–" : `${r.avgViewPct}%`}</td><td className="num text-right">{r.avgViewSec === undefined ? "–" : `${r.avgViewSec} s`}</td></tr>)}</tbody>
      </table>}
      {o.vsUsual && <p>{t("so.vs", { ratio: o.vsUsual.ratio, n: o.vsUsual.n, snap: o.vsUsual.snap })}</p>}
      <ul className="muted list-disc pl-4 text-[11px]">{o.limits.map((k) => <li key={k}>{t(`so.limit.${k}` as const)}</li>)}</ul>
    </section>
  );
}

/** STU07: the week's capacity in the publish zone. Planned and confirmed-live counted apart; failed dependencies listed as exceptions. */
function CapacityPanel({ c, records, onOpen }: { c: Capacity; records: Rec[]; onOpen: (id: string) => void }) {
  const { t } = useT();
  const day = new Intl.DateTimeFormat([], { timeZone: "UTC", weekday: "short", day: "numeric" });
  const label = (k: string) => { const [y, m, d] = k.split("-").map(Number); return day.format(Date.UTC(y, m - 1, d, 12)); };
  return (
    <section className="card mb-2 space-y-2 text-[12px]" aria-label={t("cap.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="hud-title studio-title !text-[0.7rem]">{t("cap.title")}</h3>
        <span className="muted text-[11px]">{t("cap.tz", { tz: c.timezone })}</span></div>
      <div className="overflow-x-auto"><table className="w-full text-[11px]">
        <thead className="muted"><tr><th className="text-left">{t("cap.day")}</th><th className="text-right">{t("cap.planned")}</th><th className="text-right">{t("cap.confirmed")}</th><th className="text-right">{t("cap.free")}</th></tr></thead>
        <tbody>{c.days.map((d) => <tr key={d.key}><td>{label(d.key)}</td><td className="num text-right">{d.planned}</td><td className="num text-right">{d.confirmed}</td><td className="num text-right">{d.free}</td></tr>)}</tbody>
      </table></div>
      <p>{t("cap.fill", { free: c.free, ready: c.readyToSchedule })}</p>
      {c.gap > 0 && <p>{t("cap.gap", { n: c.gap, review: c.awaitingReview, min: c.reviewMinutes })}</p>}
      {c.rendering > 0 && <p className="muted">{c.renderMinutes === null ? t("cap.renderUnknown", { n: c.rendering }) : t("cap.render", { n: c.rendering, min: c.renderMinutes })}</p>}
      <div><b>{t("cap.exceptions")}</b>
        {c.exceptions.length ? <ul className="space-y-1">{c.exceptions.map((x) => <li key={x.id}>
          <button className="hud-row w-full text-left" onClick={() => onOpen(x.id)}>⚠ {records.find((r) => r.id === x.id)?.title ?? x.title}<span className="muted block text-[11px]">{x.why}</span></button></li>)}</ul>
          : <p className="muted">{t("cap.none")}</p>}</div>
      <p className="muted text-[11px]">{t("cap.assume", { min: c.reviewEach })}</p>
    </section>
  );
}

/** STU05: large preview, the video's moments, each render's settings history, side-by-side variants, focused controls with a
 *  no-render trim preview. Rendering reuses Clip Factory's "another version"; approving and publishing stay in the clip card. */
function EditWorkspace({ rec, records, job, base, onPick, onChanged }: { rec: Rec; records: Rec[]; job: ClipJob; base: VersionEdit; onPick: (id: string) => void; onChanged: () => Promise<void> }) {
  const { t } = useT();
  const [cur, setCur] = useState(rec.clip), [cmp, setCmp] = useState<string | null>(null);
  const [draft, setDraft] = useState<(VersionForm & { id: string }) | null>(null); // the form being edited, for the no-render preview
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const c = job.clips.find((x) => x.id === cur) ?? job.clips.find((x) => x.id === rec.clip)!;
  const other = cmp ? job.clips.find((x) => x.id === cmp) : undefined;
  const hist = paramHistory(rec.revisions, base);
  const pv = draft && c.id === draft.id ? trimPreview(c.end - c.start, draft.start, draft.end) : null;
  const est = renderEstimate(job);
  const n = (id: string) => hist.find((h) => h.clip === id)?.n ?? 1;
  const player = (x: typeof c, frag = "") => x.video
    ? <video key={x.video + frag} className="w-full rounded-lg bg-black" style={{ aspectRatio: "9 / 16", maxHeight: "62vh" }} src={media(x.video) + frag} poster={x.thumb ? media(x.thumb) : undefined} controls playsInline preload="metadata" aria-label={x.title} />
    : <p className="muted">{t("se.noRender")}</p>;
  const changes = other ? editChanges(base, c.edit, other.edit) : [];
  const onVersion = async (clip: string, body: unknown) => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/studio/clips/${encodeURIComponent(job.id)}/${encodeURIComponent(clip)}/version`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setMsg(t("se.rendered")); await onChanged(); return true;
    } catch (e) { setMsg((e as Error).message); return false; } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0 space-y-2">
        <b>{c.title}</b>
        <div className={other ? "grid grid-cols-2 gap-2" : "mx-auto max-w-sm"}>
          <figure>{player(c, pv?.fragment)}<figcaption className="muted num text-[11px]">v{n(c.id)} · {c.status}</figcaption></figure>
          {other && <figure>{player(other)}<figcaption className="muted num flex items-center justify-between text-[11px]">v{n(other.id)} · {other.status}
            <button className="chip !px-1.5 !py-0" onClick={() => setCmp(null)} aria-label={t("se.closeCompare")}>×</button></figcaption></figure>}
        </div>
        {other && (changes.length ? <ul className="text-[11px]">{changes.map((x) => <li key={x.key}><span className="muted">{x.key}</span> {String(x.from)} → {String(x.to)}</li>)}</ul>
          : <p className="muted text-[11px]">{t("se.same")}</p>)}
        {pv && <p className="muted text-[11px]" aria-live="polite">{t(pv.beyond ? "se.previewBeyond" : "se.preview", { from: pv.from.toFixed(1), to: pv.to.toFixed(1) })}</p>}
        {est !== null && <p className="muted text-[11px]">{t("se.renderCost", { s: est })}</p>}
      </div>
      <aside className="space-y-3 text-[12px]">
        <section aria-label={t("se.segments")}><b>{t("se.segments")}</b>
          <ul className="mt-1 space-y-1">{records.filter((r) => r.job === job.id && !job.clips.find((x) => x.id === r.clip)?.variantOf).map((r) => {
            const x = job.clips.find((y) => y.id === r.clip)!;
            return <li key={r.id}><button className="hud-row w-full text-left" aria-current={r.clip === (job.clips.find((y) => y.id === rec.clip)?.variantOf ?? rec.clip) || undefined} onClick={() => onPick(r.id)}>
              <span className="num muted">{mmss(x.start)}–{mmss(x.end)}</span> <span className="truncate">{r.title}</span></button></li>;
          })}</ul></section>
        <section aria-label={t("se.history")}><b>{t("se.history")}</b>
          <ol className="mt-1 space-y-1">{hist.map((h) => <li key={h.clip} className="flex items-start gap-1">
            <button className="chip !px-1.5 !py-0" aria-pressed={h.clip === c.id} onClick={() => setCur(h.clip)}>v{h.n}</button>
            <span className="min-w-0 flex-1 text-[11px]">{h.status} · {h.changes.length ? h.changes.map((x) => `${x.key} → ${String(x.to)}`).join(", ") : t("se.first")}</span>
            {h.clip !== c.id && h.video && <button className="chip !px-1.5 !py-0" aria-pressed={cmp === h.clip} onClick={() => setCmp(h.clip)}>{t("se.compare")}</button>}
          </li>)}</ol></section>
        <section aria-label={t("se.controls")}><b>{t("se.controls")}</b>
          {c.status === "ready" || c.status === "approved"
            ? <VersionBox key={c.id} clip={c as never} base={{ ...base, ...c.edit } as never} busy={busy} onVersion={onVersion} onDraft={(f) => setDraft(f && { ...f, id: c.id })}
              note={msg && <p className="muted text-[11px]" role="status">{msg}</p>} />
            : <p className="muted">{t("se.notEditable")}</p>}
        </section>
      </aside>
    </div>
  );
}
