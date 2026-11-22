"use client";
import { COMMUNICATION_STORED_MAX, isBrief, withBrief } from "@/lib/brief-mode-pure";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PasswordSection } from "./PasswordSection";
import { TimeCapsuleSection } from "./TimeCapsuleSection";
import { PhonePairing } from "./PhonePairing";
import { PlaceSection } from "./PlaceSection";
import { AutonomySection } from "./AutonomySection";
import { CoreEngineSection } from "./CoreEngineSection";
import { AuthoritySection } from "./AuthoritySection";
import { PluginsSection } from "./PluginsSection";
import { WeeklyReviewSetting } from "./RemoteCall";
import { PersonaSection } from "./PersonaSection";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { KINDS, type Kind } from "@/lib/kinds";
import { BeliefsPanel, takeBeliefsRequest } from "./BeliefsPanel";
import { KnowsPanel } from "./KnowsPanel";
import { EpisodesList } from "./EpisodesList";
import { Rewind } from "./Rewind";
import { LearnThis, StudyCards } from "./StudyCards";
import { LifeStats } from "./LifeStats";
import { UsageMeter } from "./UsageMeter";
import { AgentScorecard } from "./AgentScorecard";
import { OutcomesView, ReliabilityView, TimeCostView } from "./AnalyticsOutcomes";
import { PerfRuns } from "./PerfRuns";
import { ModelRuns } from "./ModelRuns";
import { LessonsSection } from "./LessonsCard";
import { LangSwitch, useT } from "./i18n";
import { loadUsageTotals } from "@/lib/analytics-usage";
import { usageSummary, type UsageDays, type UsageTotal } from "@/lib/analytics-usage-pure";
import { eventLabel } from "@/lib/event-label-pure";
import { isLearned } from "@/lib/memory-world-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import MemoryControls from "./MemoryControls";
import WorkspaceFrame, { useWorkspaceView } from "./WorkspaceFrame";
import { DupPreview, MemoryInspector, MemoryProjects, MemoryReview, MemorySearch, PeopleView } from "./MemoryWorkspace";
import { isProvTag, type DupChoice } from "@/lib/memory-capture-pure";
import { DubVoiceSection } from "./DubVoice";

type Memory = { id: string; kind: Kind; title: string; content: string; url: string | null; storage_path: string | null; tags: string[]; created_at: string; updated_at: string; source: string; confirmation?: string | null; recheck_at?: string | null };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export { CorePanel } from "./CoreChat";

/* ---------------- MEMORY ---------------- */
type LinkRow = { id: string; status: string; score: number | null; from: { id: string; title: string } | null; to: { id: string; title: string } | null };

export function MemoryPanel({ focusId, onChanged }: { focusId: string | null; onChanged: () => void }) {
  const { t: tr } = useT();
  const [items, setItems] = useState<Memory[]>([]);
  const [hits, setHits] = useState<Memory[]>([]);
  const [q, setQ] = useState(""); // the last search run; "" = none
  const [mode, setMode] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Memory | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [form, setForm] = useState({ kind: "note" as Kind, title: "", content: "", url: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const [dup, setDup] = useState<{ duplicate: React.ComponentProps<typeof DupPreview>["dup"]; preview: React.ComponentProps<typeof DupPreview>["preview"]; again: (c: DupChoice) => void } | null>(null);
  const [learnedOnly, setLearnedOnly] = useState(false);
  const [episodesOnly, setEpisodesOnly] = useState(false);
  const [beliefs, setBeliefs] = useState(false);
  const [knows, setKnows] = useState(false); // "What ORBIT knows about you" (KnowsPanel.tsx)
  const views = (["search", "recent", "projects", "people", "review"] as const).map((id) => ({ id, label: tr(`memws.${id}`) }));
  const [view, setView] = useWorkspaceView("memory", views);
  useEffect(() => {
    if (takeBeliefsRequest()) setKnows(true); // "what do you know about me" opened MEMORY: the full "what ORBIT knows" page
    const h = (e: Event) => { if ((e as CustomEvent<NavTarget>).detail?.beliefs) { takeBeliefsRequest(); setKnows(true); } };
    addEventListener(NAV_EVENT, h);
    return () => removeEventListener(NAV_EVENT, h);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File, choice?: DupChoice) {
    setSaving(true); setErr(""); setNote(""); setDup(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (form.title.trim()) fd.set("title", form.title.trim());
      if (form.content.trim()) fd.set("note", form.content.trim());
      if (form.tags.trim()) fd.set("tags", form.tags);
      if (choice) fd.set("onDuplicate", choice);
      const res = await fetch("/api/memories/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json.preview) return setDup({ ...json, again: (c: DupChoice) => void upload(file, c) });
      if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`);
      setNote(`Saved ${file.name}${json.extractedChars ? ` (${json.extractedChars.toLocaleString()} characters of text read)` : ""}.`);
      setForm({ ...form, title: "", content: "", url: "", tags: "" });
      await Promise.all([reload(), loadLinks()]); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setSaving(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const load = useCallback(async (query: string) => {
    try {
      const r = await api<{ results: Memory[]; mode: string }>(`/api/memories${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      if (query) { setHits(r.results); setMode(r.mode); setQ(query); } else setItems(r.results);
      setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  const loadLinks = useCallback(async () => {
    try { setLinks((await api<{ links: LinkRow[] }>("/api/links")).links); } catch { /* shown via main error on next load */ }
  }, []);

  useEffect(() => { void load(""); void loadLinks(); }, [load, loadLinks]);
  const reload = () => Promise.all([load(""), q && load(q)]).then(() => {});
  useEffect(() => {
    if (!focusId) return;
    api<{ memory: Memory }>(`/api/memories/${focusId}`).then((r) => setOpen(r.memory)).catch((e) => setErr(e.message));
  }, [focusId]);

  async function capture(e?: React.FormEvent, choice?: DupChoice) {
    e?.preventDefault();
    setSaving(true); setErr(""); setNote(""); setDup(null);
    try {
      const res = await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, onDuplicate: choice }) });
      const r = await res.json().catch(() => ({}));
      if (res.status === 409 && r.preview) return setDup({ ...r, again: (c: DupChoice) => void capture(undefined, c) });
      if (!res.ok) throw new Error(r.error || `Could not save (${res.status})`);
      setNote(`Saved.${r.suggested ? ` ${r.suggested} related memories suggested below.` : ""}${r.embedded ? "" : " (keyword search only; no embeddings configured)"}`);
      setForm({ ...form, title: "", content: "", url: "", tags: "" });
      await Promise.all([reload(), loadLinks()]); onChanged();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not save"); }
    finally { setSaving(false); }
  }

  async function saveEdit() {
    if (!open) return;
    try {
      await api(`/api/memories/${open.id}`, { method: "PATCH", body: JSON.stringify({ title: open.title, content: open.content, tags: open.tags }) });
      setOpen(null); await reload(); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not update"); }
  }
  async function remove() {
    if (!open || !confirm(tr("mem.deleteConfirm", { title: open.title }))) return;
    try { await api(`/api/memories/${open.id}`, { method: "DELETE" }); setOpen(null); await Promise.all([reload(), loadLinks()]); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not delete"); }
  }
  async function decide(id: string, status: "confirmed" | "rejected") {
    try { await api("/api/links", { method: "PATCH", body: JSON.stringify({ id, status }) }); await loadLinks(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not update link"); }
  }

  const suggested = links.filter((l) => l.status === "suggested");
  const shown = learnedOnly ? items.filter((m) => isLearned(m.source)) : items;

  if (beliefs) return <BeliefsPanel onBack={() => setBeliefs(false)} />;
  if (knows) return <KnowsPanel onBack={() => setKnows(false)} onBeliefs={() => { setKnows(false); setBeliefs(true); }} />;
  if (open) {
    return (
      <div className="space-y-3">
        <button className="link" onClick={() => setOpen(null)}>{tr("mem.back")}</button>
        <input className="field w-full" value={open.title} onChange={(e) => setOpen({ ...open, title: e.target.value })} aria-label={tr("cf.titleLbl")} />
        <textarea className="field h-56 w-full" value={open.content} onChange={(e) => setOpen({ ...open, content: e.target.value })} aria-label={tr("mem.content")} />
        <input className="field w-full" value={open.tags.join(", ")} onChange={(e) => setOpen({ ...open, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} placeholder={tr("mem.tagsPh")} aria-label={tr("mem.tags")} />
        <MemoryInspector m={open} />
        <p className="muted text-xs">{open.kind} · {tr("mem.source", { s: open.source })}{open.url && <> · <a className="link" href={open.url} target="_blank" rel="noreferrer noopener">{tr("mem.openLink")}</a></>}{open.storage_path && <> · <a className="link" href={`/api/memories/${open.id}/file`} target="_blank" rel="noreferrer">{tr("mem.openFile")}</a></>} · {tr("mem.dates", { c: when(open.created_at), u: when(open.updated_at) })}</p>
        <MemoryControls key={open.id} id={open.id} content={open.content} confirmation={open.confirmation} recheckAt={open.recheck_at} onOpen={setFocus}
          onDone={(gone) => { if (gone) setOpen(null); void reload(); onChanged(); }} />
        {err && <p className="error">{err}</p>}
        <div className="flex gap-2"><button className="btn" onClick={saveEdit}>{tr("habit.save")}</button><button className="btn danger" onClick={remove}>{tr("rules.delete")}</button></div>
        <LearnThis key={open.id} memory={open} />
      </div>
    );
  }

  const row = (m: Memory, why?: React.ReactNode) => (
    <button className="card w-full text-left" onClick={() => pick(m)}>
      <div className="font-medium">{m.title}{isLearned(m.source) && <span className="badge learned ml-2 align-middle">{tr("mem.learned").toUpperCase()}</span>}</div>
      <div className="muted line-clamp-2 text-xs">{m.content.slice(0, 200)}</div>
      <div className="muted mt-1 text-[11px]">{m.kind} · {when(m.created_at)}{m.tags.some((t) => !isProvTag(t)) ? ` · ${m.tags.filter((t) => !isProvTag(t)).map((t) => `#${t}`).join(" ")}` : ""}</div>
      {why}
    </button>
  );
  const chips = <>
    <button type="button" className="chip" aria-pressed={learnedOnly} onClick={() => setLearnedOnly(!learnedOnly)}>{tr("mem.learned")}</button>
    <button type="button" className="chip" aria-pressed={episodesOnly} onClick={() => setEpisodesOnly(!episodesOnly)}>{tr("mem.episodes")}</button>
  </>;
  const learned = (xs: Memory[]) => (learnedOnly ? xs.filter((m) => isLearned(m.source)) : xs);

  return (
    <WorkspaceFrame planet="memory" title={tr("mem.title")} views={views} view={view} onView={setView}
      context={tr("memws.context", { n: items.length, r: suggested.length })}
      action={<span className="flex gap-3"><button type="button" className="link text-xs" onClick={() => setKnows(true)}>{tr("knows.open")}</button><button type="button" className="link text-xs" onClick={() => setBeliefs(true)}>{tr("mem.beliefs")}</button><a className="link text-xs" href="/api/export">{tr("mem.export")}</a><a className="link text-xs" href="/api/export/obsidian">{tr("mem.exportObsidian")}</a></span>}>
      {err && view !== "recent" && <p className="error" role="alert">{err}</p>}
      {view === "search" && (episodesOnly ? <><div className="flex gap-2">{chips}</div><EpisodesList onOpen={setFocus} /></>
        : <MemorySearch recent={learned(items)} hits={learned(hits)} searched={q} mode={mode} onSearch={(x) => (x ? void load(x) : setQ(""))} row={row}>{chips}</MemorySearch>)}
      {view === "recent" && <>
        <form onSubmit={capture} className="space-y-2">
          <h3 className="h3">{tr("mem.capture")}</h3>
          <textarea className="field h-24 w-full" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder={tr("mem.capturePh")} aria-label={tr("mem.content")} maxLength={200000} />
          <div className="flex gap-2">
            <input className="field flex-1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={tr("mem.titlePh")} aria-label={tr("cf.titleLbl")} maxLength={300} />
            <select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })} aria-label={tr("mem.kind")}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          </div>
          <div className="flex gap-2">
            <input className="field flex-1" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={tr("mem.urlPh")} aria-label={tr("mem.url")} />
            <input className="field flex-1" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder={tr("mem.tagsShort")} aria-label={tr("mem.tags")} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" disabled={saving || (!form.content.trim() && !form.url.trim() && !form.title.trim())}>{tr(saving ? "auto.saving" : "mem.save")}</button>
            <label className={`chip cursor-pointer${saving ? " opacity-50" : ""}`}>
              {tr("mem.upload")}
              <input ref={fileRef} type="file" className="sr-only" disabled={saving}
                accept=".pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            </label>
            <span className="muted text-xs">{tr("mem.uploadHint")}</span>
          </div>
          {dup && <DupPreview dup={dup.duplicate} preview={dup.preview} onChoose={dup.again} onCancel={() => setDup(null)} />}
          {note && <p className="ok">{note}</p>}
          {err && <p className="error">{err}</p>}
        </form>
        <Rewind onOpen={setFocus} />
        <div className="flex flex-wrap gap-2">{chips}</div>
        {episodesOnly ? <EpisodesList onOpen={setFocus} /> : <ul className="space-y-2">
          {shown.map((m) => <li key={m.id}>{row(m)}</li>)}
          {!shown.length && !err && <li className="muted">{tr(learnedOnly ? "mem.noLearned" : "mem.empty")}</li>}
        </ul>}
      </>}
      {view === "projects" && <MemoryProjects items={items} row={row} />}
      {view === "people" && <PeopleView />}
      {view === "review" && <>
        <StudyCards />
        <MemoryReview onChanged={onChanged} />
        {!!suggested.length && (
          <div>
            <h3 className="h3">{tr("mem.suggested")}</h3>
            <p className="muted text-xs">{tr("mem.suggestedHint")}</p>
            <ul className="mt-2 space-y-2">
              {suggested.map((l) => (
                <li key={l.id} className="card text-sm">
                  <button className="link text-left" onClick={() => l.from && setFocus(l.from.id)}>{l.from?.title}</button> ↔ <button className="link text-left" onClick={() => l.to && setFocus(l.to.id)}>{l.to?.title}</button>
                  <span className="muted"> · {Math.round((l.score ?? 0) * 100)}%</span>
                  <div className="mt-1 flex gap-2"><button className="chip" onClick={() => decide(l.id, "confirmed")}>{tr("rules.confirm")}</button><button className="chip" onClick={() => decide(l.id, "rejected")}>{tr("cf.dismiss")}</button></div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button type="button" className="chip" onClick={() => setBeliefs(true)}>{tr("mem.beliefs")}</button>
      </>}
    </WorkspaceFrame>
  );

  // Opening from a list also selects its star in the constellation (Orbit turns the event into focusId).
  function pick(m: Memory) { setOpen(m); dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id: m.id } })); }

  function setFocus(id: string) {
    api<{ memory: Memory }>(`/api/memories/${id}`).then((r) => setOpen(r.memory)).catch((e) => setErr(e.message));
  }
}

/* ---------------- PROFILE ---------------- */
const LIST_FIELDS = [["interests", "profile.interests"], ["projects", "profile.projects"], ["goals", "profile.goals"], ["news_topics", "profile.news_topics"], ["research_priorities", "profile.research_priorities"]] as const;

/** Job fit: paste a posting → score, gaps and draft texts. Drafts only: ORBIT never applies or sends anything. */
function JobFitSection() {
  const { t } = useT();
  const [posting, setPosting] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [r, setR] = useState<{ score: number; verdict: string; matches: string[]; gaps: string[]; cvSummary: string; coverLetter: string } | null>(null);
  async function run() {
    setBusy(true); setErr(""); setR(null);
    try { setR(await api("/api/jobs/fit", { method: "POST", body: JSON.stringify({ posting }) })); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <section className="space-y-2" aria-label={t("jobs.title")}>
      <b className="text-sm">{t("jobs.title")}</b> <span className="muted text-xs">{t("jobs.hint")}</span>
      <textarea aria-label={t("jobs.paste")} className="field h-24 w-full text-xs" value={posting} onChange={(e) => setPosting(e.target.value)} placeholder={t("jobs.paste")} maxLength={8000} />
      <button className="btn" disabled={busy || posting.trim().length < 80} onClick={run}>{busy ? t("jobs.busy") : t("jobs.run")}</button>
      {err && <p className="error text-xs" role="alert">{err}</p>}
      {r && <div className="space-y-1 text-xs">
        <p><b>{r.score}/100</b> · {t(r.verdict === "apply" ? "jobs.apply" : r.verdict === "stretch" ? "jobs.stretch" : "jobs.skip")}</p>
        {r.matches.length > 0 && <ul className="list-disc pl-4">{r.matches.map((m) => <li key={m}>{m}</li>)}</ul>}
        {r.gaps.length > 0 && <><p className="muted">{t("jobs.gaps")}</p><ul className="list-disc pl-4">{r.gaps.map((g) => <li key={g}>{g}</li>)}</ul></>}
        <p className="muted">{t("jobs.cv")}</p><p className="whitespace-pre-wrap">{r.cvSummary}</p>
        <p className="muted">{t("jobs.letter")}</p><p className="whitespace-pre-wrap">{r.coverLetter}</p>
      </div>}
    </section>
  );
}

export function ProfilePanel() {
  const { t } = useT();
  const [p, setP] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api<{ profile: Record<string, unknown> | null }>("/api/profile").then(({ profile }) => {
      const o: Record<string, string> = { display_name: String(profile?.display_name ?? ""), communication: String(profile?.communication ?? "") };
      for (const [k] of LIST_FIELDS) o[k] = ((profile?.[k] as string[] | undefined) ?? []).join(", ");
      setP(o);
    }).catch((e) => setMsg(e.message));
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/api/profile", { method: "PUT", body: JSON.stringify(p) }); setMsg(t("profile.saved")); } catch (e2) { setMsg(e2 instanceof Error ? e2.message : "Could not save"); }
  }
  return ( // Settings: one sentence, the three things he changes (language, about you, what ORBIT may do by itself), the rest under More
    <div className="space-y-6">
    <p className="text-sm">{t("ph.profile.what")}</p>
    <section className="space-y-1">
      <LangSwitch />
      <p className="muted text-xs">{t("lang.hint")}</p>
    </section>
    <form onSubmit={save} className="space-y-3">
      <p className="muted text-sm">{t("profile.intro")}</p>
      <label className="block text-sm">{t("profile.name")}<input className="field mt-1 w-full" value={p.display_name ?? ""} onChange={(e) => setP({ ...p, display_name: e.target.value })} /></label>
      {LIST_FIELDS.map(([k, label]) => (
        <label key={k} className="block text-sm">{t(label)} <span className="muted">{t("profile.comma")}</span>
          <input className="field mt-1 w-full" value={p[k] ?? ""} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></label>
      ))}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isBrief(p.communication)} onChange={(e) => setP({ ...p, communication: withBrief(p.communication ?? "", e.target.checked) })} /> {t("profile.brief")} <span className="muted text-xs">{t("profile.briefHint")}</span></label>
      <label className="block text-sm">{t("profile.talk")}<textarea className="field mt-1 h-20 w-full" value={p.communication ?? ""} onChange={(e) => setP({ ...p, communication: e.target.value })} maxLength={COMMUNICATION_STORED_MAX} /></label>
      <button className="btn">{t("profile.save")}</button> {msg && <span className="muted text-sm">{msg}</span>}
    </form>
    <AutonomySection />
    <details className="space-y-6">
    <summary className="chip cursor-pointer">{t("ws.more")} · <span className="muted">{t("set.moreHint")}</span></summary>
    <JobFitSection />
    <PasswordSection />
    <CoreEngineSection />
    <AuthoritySection />
    <PluginsSection />
    <PhonePairing />
    <DubVoiceSection />
    <WeeklyReviewSetting />
    <TimeCapsuleSection />
    <PlaceSection />
    <PersonaSection />
    <PlaybookSection />
    <LessonsSection />
    </details>
    </div>
  );
}

type PlaybookData = { available: boolean; message?: string; rules: string[]; version: number; history: { version: number; rules: string[]; source: string; at: string }[] };
const sourceLabel = (s: string) => (s.startsWith("user") ? "you" + (s === "user:clear" ? " (cleared)" : "") : s.startsWith("revert") ? `revert to ${s.slice(7)}` : "CORE");

function PlaybookSection() {
  const { t, tn } = useT();
  const [d, setD] = useState<PlaybookData | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [add, setAdd] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const apply = (r: PlaybookData) => { setD(r); setDraft(r.rules); };

  useEffect(() => { api<PlaybookData>("/api/playbook").then(apply).catch((e) => setMsg(e.message)); }, []);

  async function post(body: object, done = "Saved.") {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/playbook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: d?.version, ...body }) });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) { apply(await api<PlaybookData>("/api/playbook")); setMsg(json.error || "CORE updated the rules meanwhile. Reloaded."); return false; }
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      apply(json as PlaybookData); setMsg(done); return true;
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save"); return false; }
    finally { setBusy(false); }
  }

  const dirty = !!d && JSON.stringify(draft) !== JSON.stringify(d.rules);
  return (
    <section className="space-y-2" aria-labelledby="playbook-h">
      <h3 id="playbook-h" className="h3">{t("profile.playbook")}</h3>
      <p className="muted text-xs">{t("pb.intro")}</p>
      {d && !d.available ? <p className="muted text-sm">{d.message}</p> : !d ? (!msg && <p className="muted text-sm">{t("common.loading")}</p>) : (
        <>
          <ul className="space-y-2">
            {draft.map((r, i) => (
              <li key={i} className="flex gap-2">
                <input className="field flex-1 text-sm" value={r} maxLength={200} aria-label={t("pb.rule", { n: i + 1 })} disabled={busy}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? e.target.value : x)))}
                  onKeyDown={(e) => { if (e.key === "Enter" && dirty) void post({ action: "set", rules: draft }); }} />
                <button type="button" className="chip" disabled={busy} aria-label={t("pb.deleteRule", { n: i + 1 })} onClick={() => post({ action: "set", rules: draft.filter((_, j) => j !== i) }, t("pb.removed"))}>{t("rules.delete")}</button>
              </li>
            ))}
            {!draft.length && <li className="muted text-sm">{t("pb.empty")}</li>}
          </ul>
          {dirty && <div className="flex gap-2"><button type="button" className="btn" disabled={busy} onClick={() => post({ action: "set", rules: draft })}>{t("auto.saveChanges")}</button><button type="button" className="chip" onClick={() => setDraft(d.rules)}>{t("pb.undo")}</button></div>}
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (add.trim() && await post({ action: "set", rules: [...draft, add] }, t("pb.added"))) setAdd(""); }}>
            <input className="field flex-1 text-sm" value={add} onChange={(e) => setAdd(e.target.value)} placeholder={t("pb.addPh")} maxLength={200} aria-label={t("pb.newRule")} disabled={busy || draft.length >= 30} />
            <button className="btn" disabled={busy || !add.trim() || draft.length >= 30}>{t("common.add")}</button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            {!!d.rules.length && <button type="button" className="chip" disabled={busy} onClick={() => confirm(t("pb.clearConfirm")) && post({ action: "clear" }, t("pb.cleared"))}>{t("pb.clearAll")}</button>}
            {d.version > 0 && <span className="muted text-xs">{t("pb.version", { n: d.version })}</span>}
          </div>
          {d.history.length > 1 && (
            <details className="learn-history">
              <summary className="link text-xs">{t("pb.previous")}</summary>
              <ul className="mt-2 space-y-1">
                {d.history.filter((h) => h.version !== d.version).map((h) => (
                  <li key={h.version} className="flex items-center justify-between gap-2 text-xs">
                    <span className="muted" title={h.rules.join("\n") || "(no rules)"}>v{h.version} · {sourceLabel(h.source)} · {tn("pb.rules", h.rules.length)} · {when(h.at)}</span>
                    <button type="button" className="chip" disabled={busy} onClick={() => post({ action: "revert", version: h.version }, t("pb.reverted", { n: h.version }))}>{t("pb.revert")}</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {msg && <p className="muted text-sm" role="status">{msg}</p>}
    </section>
  );
}

/* ---------------- ANALYTICS (real counts) ---------------- */
export function AnalyticsPanel() {
  const { t: tr } = useT();
  const sb = useMemo(() => createClient(), []);
  const [days, setDays] = useState<UsageDays>(7);
  const views = [{ id: "outcomes", label: tr("ana.views.outcomes") }, { id: "reliability", label: tr("ana.views.reliability") }, { id: "cost", label: tr("ana.views.cost") }, { id: "perf", label: tr("ana.views.perf") }] as const;
  const [view, setView] = useWorkspaceView("analytics", views);
  const [s, setS] = useState<{ memories: number; messages: number; calls: number; tokens: number; usage: UsageTotal[]; events: { type: string; created_at: string }[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let active = true;
    setErr(""); setS(null);
    (async () => {
      const count = (t: string) => sb.from(t).select("id", { count: "exact", head: true });
      const [m, msg, usage, ev] = await Promise.all([
        count("memories"), count("messages"),
        loadUsageTotals(sb, days),
        sb.from("events").select("type, created_at").order("created_at", { ascending: false }).limit(8),
      ]);
      const bad = m.error || msg.error || ev.error;
      if (bad) throw bad;
      if (active) setS({ memories: m.count ?? 0, messages: msg.count ?? 0, ...usageSummary(usage), usage, events: ev.data ?? [] });
    })().catch((e) => { if (active) setErr(e.message ?? "Could not load analytics"); });
    return () => { active = false; };
  }, [sb, days]);
  const stat = (n: number | string, l: string) => <div className="card"><div className="text-2xl">{n}</div><div className="muted text-xs">{l}</div></div>;
  const period = <div className="flex gap-2" role="group" aria-label={tr("an.period")}>{([7, 30] as const).map((d) => <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>{tr("an.lastDays", { n: d })}</button>)}</div>;
  return (
    <WorkspaceFrame planet="analytics" title={tr("planet.analytics")} context={tr("ana.context")} action={period} views={views} view={view} onView={setView}>
      {view === "outcomes" ? <OutcomesView days={days} /> : view === "reliability" ? <ReliabilityView days={days} /> : view === "cost" ? <TimeCostView days={days} /> :
      err ? <p className="error" role="alert">{err}</p> : !s ? <p className="muted" role="status">{tr("common.loading")}</p> : <>
      <div className="grid grid-cols-2 gap-2">{stat(s.memories, tr("an.memories"))}{stat(s.messages, tr("an.messages"))}{stat(s.calls, tr("an.calls", { n: days }))}{stat(s.tokens.toLocaleString(), tr("an.tokens", { n: days }))}</div>
      <table className="w-full text-xs" aria-label={tr("an.tableAria", { n: days })}>
        <thead><tr><th className="text-left">{tr("an.model")}</th><th className="text-right">{tr("an.callsCol")}</th><th className="text-right">{tr("an.tokensCol")}</th></tr></thead>
        <tbody>{s.usage.map((g) => <tr key={JSON.stringify([g.model, g.purpose])}><td>{g.model} / {g.purpose}</td><td className="text-right num">{Number(g.calls).toLocaleString()}</td><td className="text-right num">{usageSummary([g]).tokens.toLocaleString()}</td></tr>)}{!s.usage.length && <tr><td colSpan={3} className="muted">{tr("an.noUsage")}</td></tr>}</tbody>
      </table>
      <p className="muted text-xs">{tr("an.subscription")}</p>
      <UsageMeter />
      <AgentScorecard />
      <ModelRuns />
      <PerfRuns />
      <LifeStats />
      <h3 className="h3">{tr("an.recent")}</h3>
      <ul className="space-y-1 text-sm">{s.events.map((e, i) => { const event = eventLabel(e.type); return <li key={i}><span aria-hidden="true">{event.icon}</span> <b>{event.label}</b> <span className="muted">{when(e.created_at)}</span></li>; })}{!s.events.length && <li className="muted">{tr("an.nothing")}</li>}</ul>
      </>}
    </WorkspaceFrame>
  );
}
