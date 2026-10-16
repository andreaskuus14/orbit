"use client";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CAPTION_STYLES, CHANNEL_LINK_MSG, REJECT_REASONS, bytes, channelLink, isJobActive, mmss, parseClipUrl, rootClipId } from "@/lib/clips/format";
import ReviewQueue from "./ReviewQueue";
import ClipPicks from "./ClipPicks";
import LearnedCard from "./LearnedCard";

// STUDIO clip factory: turn long videos from the inbox folder into 9:16 short clips, review and approve them.
// Data: /api/studio/clips (server owned elsewhere). Mounted inside `.studio`, fills its container like StudioStats.

// Mirrors src/lib/clips/types.ts (declared here so this file stands alone).
type ClipStatus = "rendering" | "ready" | "failed" | "approved" | "rejected";
type Clip = { id: string; start: number; end: number; title: string; hook: string; reason: string; score: number;
  status: ClipStatus; video?: string; thumb?: string; error?: string; publish?: ClipPublish; variantOf?: string; edit?: VersionEdit;
  titleOptions?: { text: string; score: number }[]; thumbOptions?: string[] };
type ClipPublish = { status: "uploading" | "done" | "scheduled" | "failed" | "unknown"; progress?: number; videoId?: string; url?: string; privacy?: string; error?: string; at: string; scheduledFor?: string };
// Mirrors src/lib/clips/schedule.ts + publish-schedule.ts (GET /api/studio/clips/schedule).
type PubSettings = { timezone: string; slots: string[]; perDay: number };
type Batch = { running: boolean; total: number; scheduled: number; error?: string; at: string };
type Schedule = { settings: PubSettings; next: string[]; batch: Batch | null };
type CaptionStyle = (typeof CAPTION_STYLES)[number];
type VersionEdit = { layout: "fit" | "fill" | "split"; camSide: "left" | "right"; captions: CaptionStyle; jumpCuts: boolean; zooms: boolean };
type VersionBody = Partial<VersionEdit> & { hook?: string; title?: string; start: number; end: number; suggest: boolean };
type Quarantined = { file: string; reason: string; at: string };
type YtStatus = { configured: boolean; connected: boolean; canUpload?: boolean };
type PublishBody = { title: string; description: string; privacy: "private" | "unlisted" | "public"; publishAt?: string; force?: boolean }; // publishAt: ISO, or "next" = next free slot
type JobStatus = "queued" | "probing" | "transcribing" | "finding" | "rendering" | "done" | "failed";
type ClipJob = { id: string; source: string; createdAt: string; updatedAt: string; status: JobStatus; progress: number; step: string;
  durationSec?: number; error?: string; warnings: string[]; clips: Clip[]; options: ClipOptions;
  timings?: { audio: number; transcribe: number; pick: number; render: number } };
type ClipOptions = { count: number; maxSec: number; captions: boolean; layout?: "fit" | "fill" | "split"; camSide?: "left" | "right";
  jumpCuts?: boolean; zooms?: boolean; language?: "auto" | "en" };
type InboxFile = { name: string; size: number; mtime: string; jobId?: string; permission?: string };
type ToolsStatus = { ffmpeg: boolean; transcriber: boolean; ytdlp: boolean; missing: string[] };
type Download = { id: string; url: string; status: "queued" | "downloading" | "done" | "failed"; progress: number; step: string; file?: string; error?: string;
  createdAt: string; permission: string; autoClip?: ClipJob["options"] };
type Data = { root: string; tools: ToolsStatus; inbox: InboxFile[]; jobs: ClipJob[]; downloads: Download[]; quarantined?: Quarantined[]; publishing?: string | null };
type Opts = Required<ClipOptions>;

const API = "/api/studio/clips";
const SETUP = "cd C:\\Users\\andre\\Documents\\orbit; npm install; npm run app:rebuild";
const YTDLP_SETUP = "winget install yt-dlp.yt-dlp";
const media = (p: string) => `${API}/media?f=${encodeURIComponent(p)}`;
const when = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""; };
// shortcut: the contract doesn't fix the score scale; treat ≤1 as 0..1, otherwise as 0..100.
const score = (s: number) => Math.round(Number.isFinite(s) ? (s <= 1 ? s * 100 : s) : 0);

class HttpError extends Error { constructor(msg: string, readonly status: number) { super(msg); } }
async function api<T>(url: string, init?: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, init ? { method: init.method, cache: "no-store", headers: init.body ? { "Content-Type": "application/json" } : undefined, body: init.body ? JSON.stringify(init.body) : undefined } : { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(json.error || `Request failed (${res.status})`, res.status);
  return json as T;
}

const JOB_LABEL: Record<JobStatus, string> = { queued: "⏳ Queued", probing: "🔍 Reading video", transcribing: "📝 Transcribing", finding: "✨ Finding moments", rendering: "🎞 Rendering", done: "✓ Done", failed: "⚠ Failed" };
const CLIP_LABEL: Record<ClipStatus, string> = { rendering: "🎞 Rendering", ready: "● Ready for review", failed: "⚠ Failed", approved: "✓ Approved", rejected: "✕ Rejected" };
const Status = ({ text, tone }: { text: string; tone?: "good" | "bad" }) => (
  <span className="chip !cursor-default whitespace-nowrap !px-2 !py-0.5 !text-[10px]" style={tone === "good" ? { borderColor: "#ff8fab", color: "#ffd6e0" } : tone === "bad" ? { borderColor: "#fb7185", color: "#fda4af" } : undefined}>{text}</span>
);
const toneOf = (s: string) => (s === "done" || s === "approved" ? "good" : s === "failed" || s === "rejected" ? "bad" : undefined);

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="hud-title studio-title !text-[0.7rem]">{title.toUpperCase()}</h3>{right}
      </div>
      {children}
    </section>
  );
}
const Skeleton = ({ h, reduced }: { h: number; reduced: boolean }) => <div aria-hidden className={`card ${reduced ? "" : "animate-pulse"}`} style={{ height: h, opacity: 0.6 }} />;

type Tab = "find" | "clips" | "insights";
const TAB_KEY = "orbit.clipFactory.tab";
const readTab = (): Tab | null => {
  try { const t = localStorage.getItem(TAB_KEY); return t === "find" || t === "clips" || t === "insights" ? t : null; }
  catch { return null; } // storage unavailable (or server render)
};

/** "(?)": a long explanation behind a small button; hover shows it as a tooltip, click/tap/keyboard toggles it inline. */
function Help({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      {/* 24px hit target around a 16px circle; negative margin keeps the text line height */}
      <button type="button" className="muted -my-1 inline-grid h-6 w-6 place-items-center rounded-full align-middle"
        title={text} aria-label="More info" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full border border-white/20 text-[10px] leading-none">?</span>
      </button>
      <span id={id} hidden={!open} className="muted mt-0.5 block w-full text-[11px] leading-snug">{text}</span>
    </>
  );
}

/** Same empty state everywhere: one helpful sentence and (optionally) the button that fixes it. */
const Empty = ({ text, action }: { text: string; action?: ReactNode }) => (
  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-white/10 p-3 text-sm">
    <p className="muted min-w-0 flex-1">{text}</p>{action}
  </div>
);

/** Two-click confirm without window.confirm: first click arms ("Sure?"), second runs; blur or 4 s disarms. */
function ConfirmButton({ id, label, sure = "Sure?", aria, onConfirm, disabled, className = "chip" }: { id?: string; label: string; sure?: string; aria: string; onConfirm: () => void; disabled?: boolean; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return (
    <button id={id} className={className} disabled={disabled} onBlur={() => setArmed(false)} aria-label={armed ? `Confirm: ${aria}` : aria}
      style={armed ? { borderColor: "#fb7185" } : undefined} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? sure : label}
    </button>
  );
}

/* ---------- panel ---------- */

const seenReview = new WeakSet<object>();
export default function ClipFactory({ reduced, onClose, review }: { reduced: boolean; onClose?: () => void; review?: object | null /* a new object opens the morning review */ }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<Record<string, ClipOptions>>({}); // source → options that got a 409
  const [form, setForm] = useState<string | null>(null);
  const [opts, setOpts] = useState<Opts>({ count: 5, maxSec: 45, captions: true, layout: "fit", camSide: "right", jumpCuts: true, zooms: true, language: "en" });
  const [showRejected, setShowRejected] = useState(false);
  const [visible, setVisible] = useState(true);
  const [yt, setYt] = useState<YtStatus | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null); // null until the first load picks one
  const [scoutRun, setScoutRun] = useState(0); // bumped by the "Find videos" next step: ScoutSection runs the scout
  // Each review request opens once; the same object lingers in Orbit's state until STUDIO is left.
  useEffect(() => { if (review && !seenReview.has(review)) { seenReview.add(review); setReviewing(true); } }, [review]);
  const seq = useRef(0);

  const load = useCallback(async (quiet = false) => {
    const s = ++seq.current;
    if (!quiet) setLoading(true);
    try {
      const json = await api<Data>(API);
      if (s === seq.current) { setData(json); setErr(""); }
    } catch (e) { if (s === seq.current) setErr(e instanceof Error ? e.message : "Couldn't load the clip factory"); }
    finally { setLoading(false); } // unconditional: an edit bumps seq, which must not strand the spinner
  }, []);
  useEffect(() => { void load(); }, [load]);
  const loadYt = useCallback(() => api<YtStatus>("/api/studio/oauth/status").then(setYt, () => setYt(null)), []);
  useEffect(() => { void loadYt(); }, [loadYt]);

  // Poll every 2 s while anything is in progress and the tab is visible.
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    on(); document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  // An "uploading" clip the server isn't uploading (a lost final save) never changes on its own: don't poll for it.
  const active = !!data?.jobs.some((j) => isJobActive(j) || j.clips.some((c) => c.publish?.status === "uploading" && data.publishing === `${j.id}/${c.id}`)) || !!data?.downloads?.some((d) => d.status === "queued" || d.status === "downloading");
  useEffect(() => {
    if (!active || !visible) return;
    const t = setInterval(() => void load(true), 2000);
    return () => clearInterval(t);
  }, [active, visible, load]);

  /** Run an action keyed for its busy flag and inline error note. */
  async function act(key: string, fn: () => Promise<void>): Promise<boolean> {
    setBusy((b) => ({ ...b, [key]: true })); setNotes((n) => ({ ...n, [key]: "" }));
    try { await fn(); return true; }
    catch (e) { setNotes((n) => ({ ...n, [key]: e instanceof Error ? e.message : "Something went wrong" })); return false; }
    finally { setBusy((b) => ({ ...b, [key]: false })); }
  }
  const Note = ({ k }: { k: string }) => (notes[k] ? <p className="error mt-1 text-xs" role="alert">{notes[k]}</p> : null);

  const make = (source: string, o: ClipOptions, force = false) => act(`make:${source}`, async () => {
    try {
      await api(API, { method: "POST", body: { source, ...o, ...(force ? { force: true } : {}) } });
      setForm(null); setConflict((c) => { const n = { ...c }; delete n[source]; return n; });
      await load(true);
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) { setConflict((c) => ({ ...c, [source]: o })); return; }
      throw e;
    }
  });

  const clipUrl = (job: string, clip: string) => `${API}/${encodeURIComponent(job)}/${encodeURIComponent(clip)}`;
  const putClip = (job: string, clip: string, next: Clip) => {
    seq.current++; // a poll already in flight carries the pre-edit state: drop it
    setData((d) => d && { ...d, jobs: d.jobs.map((j) => (j.id !== job ? j : { ...j, clips: j.clips.map((c) => (c.id === clip ? next : c)) })) });
  };
  const patchClip = (job: string, clip: string, body: PatchBody) => act(`clip:${job}/${clip}`, async () => {
    putClip(job, clip, (await api<{ clip: Clip }>(clipUrl(job, clip), { method: "PATCH", body })).clip);
  });
  const moreTitles = (job: string, clip: string) => act(`titles:${job}/${clip}`, async () => {
    putClip(job, clip, (await api<{ clip: Clip }>(`${clipUrl(job, clip)}/titles`, { method: "POST" })).clip);
  });
  const publish = (job: string, clip: string, body: PublishBody) => act(`pub:${job}/${clip}`, async () => {
    putClip(job, clip, (await api<{ clip: Clip }>(`${clipUrl(job, clip)}/publish`, { method: "POST", body })).clip);
    setData((d) => d && { ...d, publishing: `${job}/${clip}` }); // started under the server's lock: it's the running upload
  });
  const checkYouTube = (job: string, clip: string) => act(`pub:${job}/${clip}`, async () => {
    putClip(job, clip, (await api<{ clip: Clip }>(`${clipUrl(job, clip)}/publish/check`, { method: "POST" })).clip);
  });
  const version = (job: string, clip: string, body: VersionBody) => act(`ver:${job}/${clip}`, async () => {
    await api(`${clipUrl(job, clip)}/version`, { method: "POST", body });
    await load(true); // the new version sits after the original's other versions, as the server ordered them
  });

  const del = (job: string) => act(`del:${job}`, async () => {
    await api(`${API}/${encodeURIComponent(job)}`, { method: "DELETE" });
    seq.current++;
    setData((d) => d && { ...d, jobs: d.jobs.filter((j) => j.id !== job), inbox: d.inbox.map((f) => (f.jobId === job ? { ...f, jobId: undefined } : f)) });
  });

  const download = (body: { url: string; permission: string; autoClip?: ClipOptions }, replaces?: string) => act(replaces ? `dl:${replaces}` : "dl", async () => {
    await api(`${API}/download`, { method: "POST", body });
    if (replaces) await api(`${API}/download/${encodeURIComponent(replaces)}`, { method: "DELETE" }).catch(() => {}); // retry = resubmit, drop the failed record
    await load(true);
  });

  const delDownload = (id: string) => act(`dl:${id}`, async () => {
    await api(`${API}/download/${encodeURIComponent(id)}`, { method: "DELETE" });
    seq.current++;
    setData((d) => d && { ...d, downloads: d.downloads.filter((x) => x.id !== id) });
  });

  const openFolder = () => act("open", async () => {
    try { await api(`${API}/open`, { method: "POST" }); setNotes((n) => ({ ...n, opened: "Opened in Explorer." })); }
    catch (e) {
      if (e instanceof HttpError && e.status === 501) throw new Error("Opening the folder only works on the Windows PC. Use the path above.");
      throw e;
    }
  });

  const jobs = [...(data?.jobs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const rejectedCount = jobs.reduce((s, j) => s + j.clips.filter((c) => c.status === "rejected").length, 0);
  const unpublished = jobs.reduce((s, j) => s + j.clips.filter((c) => c.status === "approved" && (!c.publish || c.publish.status === "failed")).length, 0);
  const fresh = jobs.reduce((s, j) => s + j.clips.filter((c) => c.status === "ready").length, 0);
  const workingJobs = jobs.filter(isJobActive), dls = (data?.downloads ?? []).filter((d) => d.status === "queued" || d.status === "downloading");
  // Open on the tab with work in it; otherwise where the owner left off.
  const auto: Tab = fresh || workingJobs.length ? "clips" : readTab() ?? "find";
  useEffect(() => { if (data && !tab) setTab(auto); }, [data, tab, auto]);
  const shown = tab ?? auto;
  const selectTab = (t: Tab) => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable */ } };
  if (reviewing) return <ReviewQueue reduced={reduced} onClose={() => { setReviewing(false); setTab("clips"); void load(true); }} />;

  const avg = (xs: number[]) => Math.round((xs.reduce((s, x) => s + Math.min(1, Math.max(0, x || 0)), 0) / Math.max(1, xs.length)) * 100);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const workText = workingJobs.length ? `⏳ ${plural(workingJobs.length, "job")} working… ${avg(workingJobs.map((j) => j.progress))}%`
    : dls.length ? `⬇ ${plural(dls.length, "download")}… ${avg(dls.map((d) => d.progress))}%` : "";
  const workNext = <button className="chip num" onClick={() => selectTab(workingJobs.length ? "clips" : "find")} aria-label={`${workText}. Show progress`}>{workText}</button>;
  const goSchedule = () => { selectTab("clips"); requestAnimationFrame(() => document.getElementById("schedule-all")?.focus()); };
  // One obvious next step, in priority order: review > schedule > connect YouTube > wait for work > find videos.
  const next = fresh ? <button className="btn" onClick={() => setReviewing(true)} aria-label={`Review ${fresh} new clips`}>☀ {plural(fresh, "clip")} ready to review</button>
    : unpublished && yt?.canUpload ? <button className="btn" onClick={goSchedule} aria-label={`Schedule all ${unpublished} approved clips`}>🕒 {unpublished} approved → Schedule all</button>
    : unpublished && yt?.configured ? <a className="btn" href="/api/studio/oauth/start">🔗 Connect YouTube to publish {unpublished} approved</a>
    : workText ? workNext
    : <button className="btn" onClick={() => { selectTab("find"); setScoutRun((n) => n + 1); }} aria-label="Find videos: run the video scout">🔭 Find videos</button>;
  const tabs: [Tab, string][] = [["find", "🔭 Find videos"], ["clips", `🎬 Clips${fresh ? ` (${fresh} new)` : ""}`], ["insights", "🧠 Insights"]];
  const onTabKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const t = tabs[(tabs.findIndex(([id]) => id === shown) + d + tabs.length) % tabs.length][0];
    selectTab(t); document.getElementById(`cf-tab-${t}`)?.focus();
  };

  return (
    <div className={`studio-clips glass @container h-full w-full overflow-y-auto p-3 sm:p-4 ${reduced ? "" : "panel-in"}`} role="region" aria-label="Clip factory" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="hud-title studio-title truncate">CLIP FACTORY</h2>
        <div className="flex items-center gap-2">
          <button className="chip" onClick={() => { void load(); void loadYt(); }} disabled={loading} aria-label={loading ? "Refreshing clip factory" : "Refresh clip factory"}>↻ Refresh</button>
          {onClose && <button className="chip" onClick={onClose} aria-label="Close clip factory">×</button>}
        </div>
      </div>

      {err && (
        <div className="card mt-3 text-sm" role="alert">
          <p className="error">{err}</p>
          <button className="btn mt-2" onClick={() => load()} disabled={loading}>Try again</button>
        </div>
      )}

      {loading && !data && !err && (
        <div className="mt-3 space-y-3" role="status" aria-label="Loading clip factory"><span className="sr-only">Loading…</span>
          <Skeleton h={120} reduced={reduced} /><Skeleton h={90} reduced={reduced} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">{Array.from({ length: 4 }, (_, k) => <Skeleton key={k} h={260} reduced={reduced} />)}</div>
        </div>
      )}

      {data && (
        <div className="mt-3 space-y-3">
          <section className="card flex min-h-[3.25rem] flex-wrap items-center gap-x-3 gap-y-1.5" aria-label="Next step">
            <span className="muted text-[10px] uppercase tracking-widest">Next</span>
            {next}
            {workText && next !== workNext && <span className="muted num text-[11px]">{workText}</span>}
            <span className="sr-only" aria-live="polite">{active ? "Working… auto-updating" : ""}</span>{/* no % here: it would be re-announced every poll */}
          </section>

          {(!data.tools.ffmpeg || !data.tools.transcriber) && <ToolsBanner tools={data.tools} />}
          {!!data.quarantined?.length && <QuarantineNotice root={data.root} files={data.quarantined} />}

          <div role="tablist" aria-label="Clip factory sections" className="flex flex-wrap gap-1.5" onKeyDown={onTabKey}>
            {tabs.map(([id, text]) => (
              <button key={id} id={`cf-tab-${id}`} role="tab" className="chip !px-3 !py-1" aria-selected={shown === id} aria-controls={`cf-panel-${id}`}
                tabIndex={shown === id ? 0 : -1} onClick={() => selectTab(id)}>{text}</button>
            ))}
          </div>

          {/* Panels stay mounted (hidden) so forms, polling and scroll state survive switching tabs. */}
          <div id="cf-panel-insights" role="tabpanel" aria-labelledby="cf-tab-insights" hidden={shown !== "insights"} className="space-y-3">
            <LearnedCard defaultOpen />
          </div>

          <div id="cf-panel-find" role="tabpanel" aria-labelledby="cf-tab-find" hidden={shown !== "find"} className="space-y-3">
          <ScoutSection visible={visible} onQueued={() => void load(true)} runSignal={scoutRun} reduced={reduced} />

          <Section title="Inbox">
            <p className="text-sm">Drop long videos into your Studio inbox folder:</p>
            <code className="num mt-1 block overflow-x-auto whitespace-nowrap rounded bg-black/40 p-2 text-xs">{data.root}</code>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button className="chip" onClick={openFolder} disabled={busy.open}>{busy.open ? "Opening…" : "📂 Open inbox folder"}</button>
              {notes.opened && !notes.open && <span className="ok text-xs" role="status">{notes.opened}</span>}
            </div>
            <Note k="open" />
            <p className="muted mt-2 text-xs">Only clip videos you&apos;re allowed to. <Help text="Use your own uploads, or creators who allow clipping." /></p>

            <AddFromLink tools={data.tools} opts={opts} setOpts={setOpts} busy={busy.dl} onSubmit={(body) => download(body)} />
            <Note k="dl" />
            {(data.downloads ?? []).length > 0 && (
              <ul className="mt-2 space-y-2" aria-label="Downloads">
                {data.downloads.map((d) => (
                  <li key={d.id} className="rounded-xl border border-white/10 p-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b className="min-w-0 flex-1 truncate" title={d.url}>{d.file ?? d.url}</b>
                      <div className="flex items-center gap-1.5">
                        <Status text={DL_LABEL[d.status]} tone={toneOf(d.status)} />
                        <ConfirmButton label={d.status === "queued" || d.status === "downloading" ? "Cancel" : "Remove"} sure="Sure?" aria={`Remove download ${d.url}`}
                          onConfirm={() => void delDownload(d.id)} disabled={busy[`dl:${d.id}`]} />
                      </div>
                    </div>
                    {d.status === "downloading" && <Progress pct={Math.round(d.progress * 100)} step={d.step} label={`Download progress for ${d.url}`} reduced={reduced} />}
                    {d.status === "failed" && (
                      <div className="mt-1" role="alert">
                        <p className="error">{d.error || "The download failed."}</p>
                        <button className="btn mt-1" disabled={busy[`dl:${d.id}`] || !data.tools.ytdlp}
                          onClick={() => void download({ url: d.url, permission: d.permission, ...(d.autoClip ? { autoClip: d.autoClip } : {}) }, d.id)}>
                          {busy[`dl:${d.id}`] ? "Starting…" : "Try again"}
                        </button>
                      </div>
                    )}
                    <Note k={`dl:${d.id}`} />
                  </li>
                ))}
              </ul>
            )}

            {!data.inbox.length ? (
              <Empty text="The inbox is empty. Drop a video file into the folder, then refresh." action={<button className="chip" onClick={() => void load()} disabled={loading}>↻ Refresh</button>} />
            ) : (
              <ul className="mt-3 space-y-2" aria-label="Inbox videos">
                {data.inbox.map((f) => {
                  const job = f.jobId ? byId.get(f.jobId) : undefined, k = `make:${f.name}`, fid = `clipform-${f.name.replace(/[^\w-]/g, "_")}`;
                  return (
                    <li key={f.name} className="rounded-xl border border-white/10 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <b className="block truncate text-sm" title={f.name}>{f.name}</b>
                          <span className="muted num text-[11px]">{bytes(f.size)} · {when(f.mtime)}</span>
                          {f.permission && <span className="muted block truncate text-[11px]" title={f.permission}>Permission: {f.permission}</span>}
                        </div>
                        {f.jobId ? (
                          job ? <Status text={JOB_LABEL[job.status] ?? job.status} tone={toneOf(job.status)} /> : <Status text="Has a job" />
                        ) : (
                          <button className="chip" aria-expanded={form === f.name} aria-controls={fid} onClick={() => setForm((c) => (c === f.name ? null : f.name))}
                            aria-label={`Make clips from ${f.name}`}>🎬 Make clips</button>
                        )}
                      </div>
                      {form === f.name && !f.jobId && (
                        <form id={fid} className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2 text-xs" onSubmit={(e) => { e.preventDefault(); void make(f.name, { ...opts, captions: opts.captions && data.tools.transcriber }); }}>
                          <Choice legend="Number of clips" values={[3, 5, 8]} value={opts.count} fmt={String} onChange={(count) => setOpts((o) => ({ ...o, count }))} />
                          <Choice legend="Max length" values={[30, 45, 60]} value={opts.maxSec} fmt={(v) => `${v} s`} onChange={(maxSec) => setOpts((o) => ({ ...o, maxSec }))} />
                          <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={opts.captions && data.tools.transcriber} onChange={(e) => setOpts((o) => ({ ...o, captions: e.target.checked }))} disabled={!data.tools.transcriber} />
                            Captions{!data.tools.transcriber ? " (needs transcriber)" : ""}
                          </label>
                          <EditOptions opts={opts} setOpts={setOpts} />
                          <button type="submit" className="btn" disabled={busy[k] || !data.tools.ffmpeg}>{busy[k] ? "Starting…" : "Start"}</button>
                        </form>
                      )}
                      {conflict[f.name] && <Conflict onAgain={() => make(f.name, conflict[f.name], true)} busy={busy[k]} />}
                      <Note k={k} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          </div>

          <div id="cf-panel-clips" role="tabpanel" aria-labelledby="cf-tab-clips" hidden={shown !== "clips"} className="space-y-3">
          <Section title="Clip jobs" right={<>
            <ScheduleAll count={unpublished} canUpload={!!yt?.canUpload} onChange={load} />
            {rejectedCount > 0 && (
              <button className="chip" aria-pressed={showRejected} onClick={() => setShowRejected((s) => !s)} aria-label={`${showRejected ? "Hide" : "Show"} ${rejectedCount} rejected clips`}>
                {showRejected ? "Hide" : "Show"} rejected ({rejectedCount})
              </button>
            )}
          </>}>
            {!jobs.length && <Empty text="No clips yet. Find a video to clip, or add one from a link." action={<button className="btn" onClick={() => selectTab("find")}>🔭 Find videos</button>} />}
            <div className="space-y-3">
              {jobs.map((j) => (
                <JobCard key={j.id} job={j} reduced={reduced} showRejected={showRejected} busy={busy} Note={Note} yt={yt} publishing={data.publishing}
                  onRetry={() => make(j.source, j.options, true)} onDelete={() => del(j.id)}
                  onPatch={(clip, body) => patchClip(j.id, clip, body)} onPublish={(clip, body) => publish(j.id, clip, body)}
                  onCheck={(clip) => checkYouTube(j.id, clip)} onVersion={(clip, body) => version(j.id, clip, body)} onTitles={(clip) => moreTitles(j.id, clip)} />
              ))}
            </div>
          </Section>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- video scout ---------- */

// Mirrors src/lib/clips/scout-pure.ts.
type ScoutCreator = { channelId: string; title: string; autoClip: boolean };
type ScoutPick = { videoId: string; url: string; title: string; channel: string; channelId: string; durationSec: number; publishedAt: string;
  stats: { views: number; likes: number; comments: number }; score: number; reason: string; source: "watchlist" | "keyword"; status: "new" | "queued" | "dismissed"; error?: string };
type CreatorOp = { channelId: string; autoClip?: boolean; remove?: true }; // PATCH { creator }: one creator, applied server-side
type ScoutPatch = Partial<ScoutSettings> & { creator?: CreatorOp };
type ScoutSettings = { watchlist: ScoutCreator[]; keywords: string[]; aiKeywords: string[]; nicheAuto: boolean; maxAgeHours: number; creatorMaxAgeDays: number; minMinutes: number; dailyAuto: number; runAt: number };
type ScoutData = { scout: ScoutSettings & { picks: ScoutPick[]; lastRun?: { at: string; ok: boolean; error?: string; warnings: string[]; candidates: number; units: number; ranker: "claude" | "score"; auto: number; summary?: string };
  niche?: NicheReport; nicheRun?: { at: string; ok: boolean; error?: string; units: number; warnings: string[] } };
  running: boolean; researching?: boolean; configured: boolean; budget: number; usedToday: number };
type NicheReport = { at: string; niches: { name: string; why: string; score: number; keywords: string[] }[];
  creators: { channelId: string; title: string; subscribers: number; niche: string; evidence: string }[] };
const SCOUT = `${API}/scout`;
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(Math.round(n)));
const ago = (iso: string) => { const h = (Date.now() - Date.parse(iso)) / 3_600_000; return !Number.isFinite(h) ? "" : h < 1 ? "just now" : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`; };

/** Finds source videos by itself: approved creators (watchlist) + niche keyword searches, ranked for clip potential. */
function ScoutSection({ visible, onQueued, runSignal, reduced }: { visible: boolean; onQueued: () => void; runSignal: number; reduced: boolean }) {
  const [d, setD] = useState<ScoutData | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api<ScoutData>(SCOUT).then((x) => { setD(x); setErr(""); }, (e) => setErr(e instanceof Error ? e.message : "Couldn't load the scout")), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!d?.running || !visible) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [d?.running, visible, load]);
  async function act(key: string, fn: () => Promise<void>) {
    setBusy((b) => ({ ...b, [key]: true })); setNotes((n) => ({ ...n, [key]: "" }));
    try { await fn(); return true; }
    catch (e) { setNotes((n) => ({ ...n, [key]: e instanceof Error ? e.message : "Something went wrong" })); return false; }
    finally { setBusy((b) => ({ ...b, [key]: false })); }
  }
  const Note = ({ k }: { k: string }) => (notes[k] ? <p className="error mt-1 text-xs" role="alert">{notes[k]}</p> : null);
  const run = () => act("run", async () => { await api(SCOUT, { method: "POST" }); setD((x) => x && { ...x, running: true }); });
  // The panel's "Find videos" next step bumps runSignal: run once it's loaded (if it can run and isn't already).
  const seenSignal = useRef(runSignal);
  useEffect(() => {
    if (runSignal === seenSignal.current) return;
    seenSignal.current = runSignal; // consumed even when the scout isn't loaded (or failed to): never fire later by surprise
    if (d?.configured && !d.running) void run();
  }, [runSignal, d]); // eslint-disable-line react-hooks/exhaustive-deps -- run is recreated each render; the signal is the trigger
  const pick = (p: ScoutPick, action: "clip" | "dismiss") => act(`pick:${p.videoId}`, async () => {
    setD(await api<ScoutData>(`${SCOUT}/picks`, { method: "POST", body: { videoId: p.videoId, action } }));
    if (action === "clip") onQueued();
  });
  const [added, setAdded] = useState("");
  const save = (key: string, body: ScoutPatch) => { setAdded(""); return act(key, async () => { setD(await api<ScoutData>(SCOUT, { method: "PATCH", body })); }); };
  const addCreator = (input: string) => act("add", async () => {
    setAdded("");
    const r = await api<ScoutData & { added: { title: string; subscribers: number | null; already: boolean } }>(`${SCOUT}/creators`, { method: "POST", body: { input } });
    setD(r);
    const a = r.added; // shown so the owner can check it's the right channel
    setAdded(`${a.already ? "Already watching" : "✓ Added"} ${a.title}${a.subscribers != null ? ` (${compact(a.subscribers)} subscribers)` : ""}. Not the one? Remove it and paste a link to one of their videos.`);
  });

  const s = d?.scout, last = s?.lastRun, picks = (s?.picks ?? []).filter((p) => p.status !== "dismissed");
  return (
    <Section title="Video scout" right={d && (
      <div className="flex items-center gap-1.5">
        <button className="chip" aria-expanded={open} aria-controls="scout-settings" onClick={() => setOpen((o) => !o)} aria-label="Scout settings">⚙ Settings</button>
        <button className="btn !px-3 !py-1 !text-xs" onClick={() => void run()} disabled={busy.run || d.running || !d.configured} aria-label="Run the video scout now">{d.running ? (d.researching ? "Researching…" : "Scouting…") : busy.run ? "Starting…" : "🔭 Run scout now"}</button>
      </div>
    )}>
      {err && <p className="error text-xs" role="alert">{err}</p>}
      {!d && !err && <div className="space-y-2" role="status" aria-label="Loading the scout"><span className="sr-only">Loading the scout…</span><Skeleton h={18} reduced={reduced} /><Skeleton h={90} reduced={reduced} /></div>}
      {d && !d.configured && <p className="text-xs">Add <code className="num rounded bg-black/40 px-1">YOUTUBE_API_KEY</code> to .env.local and restart ORBIT so the scout can search YouTube.</p>}
      {d && s && (
        <>
          <div className="flex flex-wrap items-center gap-x-1">
          <p className="muted num text-[11px]" aria-live="polite">
            {last ? `Last run ${ago(last.at)} · ${last.candidates} videos checked${last.auto ? ` · ${last.auto} auto-clipped` : ""}` : "Never run yet"}
          </p>
            <Help text={`${last ? `Last run ${when(last.at)}, ranked by ${last.ranker === "claude" ? "Claude" : "stats"}. ` : ""}YouTube budget today ${d.usedToday}/${d.budget} units. Runs daily at ${String(s.runAt).padStart(2, "0")}:00.`} />
          </div>
          {last && !last.ok && <p className="error mt-1 text-xs" role="alert">⚠ {last.error}</p>}
          {!!last?.warnings?.length && <ul className="mt-1 space-y-0.5 text-[11px]" aria-label="Scout warnings">{last.warnings.slice(0, 5).map((w, k) => <li key={k}>⚠ {w}</li>)}</ul>}
          <Note k="run" />
          <CreatorsBox s={s} busy={busy} Note={Note} added={added} onSave={save} onAdd={addCreator} />
          <NicheCard d={d} busy={busy} Note={Note} onSave={save} onAdd={addCreator}
            onResearch={() => act("niche", async () => { await api(`${SCOUT}/niche`, { method: "POST", body: {} }); setD((x) => x && { ...x, running: true, researching: true }); })}
            onUse={(name) => act("niche", async () => { setD(await api<ScoutData>(`${SCOUT}/niche`, { method: "POST", body: { use: name } })); })} />
          {open && <ScoutSettingsForm s={s} busy={busy} Note={Note} onSave={save} />}
          {last?.ok && last.summary && <p className="num mt-2 text-[11px]" role="status">{last.summary}</p>}
          {!picks.length ? (
            s.watchlist.length || s.keywords.length || s.aiKeywords.length
              ? <Empty text={last ? "No picks yet. Lower the min length or raise the max age in ⚙ Settings, or add more creators." : "No picks yet. Run the scout to find videos."}
                  action={<button className="chip" onClick={() => void run()} disabled={busy.run || d.running || !d.configured}>🔭 Run scout</button>} />
              : <Empty text="Add a creator above (someone who allows clipping), then run the scout." />
          ) : (
            <ul className="mt-2 space-y-2" aria-label="Scout picks">
              {picks.map((p) => (
                <li key={p.videoId} className="flex gap-2 rounded-xl border border-white/10 p-2 text-xs">
                  <a href={`https://www.youtube.com/watch?v=${p.videoId}`} target="_blank" rel="noopener noreferrer" className="shrink-0" aria-label={`Open ${p.title} on YouTube`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`https://i.ytimg.com/vi/${p.videoId}/mqdefault.jpg`} alt="" loading="lazy" className="h-[4.5rem] w-32 rounded-lg object-cover" />
                  </a>
                  <div className="min-w-0 flex-1">
                    <b className="line-clamp-2 leading-snug">{p.title}</b>
                    <span className="muted num block text-[11px]">{p.channel} · {mmss(p.durationSec)} · {ago(p.publishedAt)} · {compact(p.stats.views)} views</span>
                    <p className="mt-0.5 leading-snug">{p.reason}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Status text={`score ${p.score}/100`} tone={p.score >= 70 ? "good" : undefined} />
                      <Status text={p.source === "watchlist" ? "★ Watchlist" : "🔎 Keyword"} />
                      {p.status === "queued" ? <Status text="✓ Sent to clip maker ↓" tone="good" /> : (
                        <>
                          <button className="chip" onClick={() => void pick(p, "clip")} disabled={busy[`pick:${p.videoId}`]} aria-label={`Clip ${p.title}`}>✂ Clip it</button>
                          <button className="chip" onClick={() => void pick(p, "dismiss")} disabled={busy[`pick:${p.videoId}`]} aria-label={`Dismiss ${p.title}`}>Dismiss</button>
                        </>
                      )}
                    </div>
                    {p.error && <p className="error mt-1 text-[11px]">⚠ {p.error}</p>}
                    <Note k={`pick:${p.videoId}`} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {picks.some((p) => p.source === "keyword") && <p className="muted mt-2 text-[11px]">🔎 Keyword finds: check permission first. <Help text="Keyword finds come from creators you haven't approved: check they allow clipping before you press Clip it." /></p>}
        </>
      )}
    </Section>
  );
}

/** Creators the owner approved for clipping: always visible at the top of the scout (the main way to feed it). */
function CreatorsBox({ s, busy, Note, added, onSave, onAdd }: { s: ScoutSettings; busy: Record<string, boolean>; Note: (p: { k: string }) => ReactNode; added: string;
  onSave: (key: string, body: ScoutPatch) => Promise<boolean>; onAdd: (input: string) => Promise<boolean> }) {
  const [input, setInput] = useState("");
  const setWatch = (creator: CreatorOp) => void onSave("watch", { creator });
  return (
    <div className="mt-2 rounded-xl border border-white/10 p-2 text-xs">
      <b className="block text-sm">★ Creators</b>
      <p className="muted text-[11px]">Only creators who allow clipping. <Help text="Auto-clip lets the daily run download their best new video by itself (up to the daily limit); finished clips still wait for your review." /></p>
      <ul className="mt-1 space-y-1" aria-label="Watchlist">
        {s.watchlist.map((w) => (
          <li key={w.channelId} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate" title={w.channelId}>{w.title}</span>
            <label className="flex items-center gap-1"><input type="checkbox" checked={w.autoClip} disabled={busy.watch}
              onChange={(e) => setWatch({ channelId: w.channelId, autoClip: e.target.checked })} aria-label={`Auto-clip ${w.title}`} /> Auto-clip</label>
            <ConfirmButton label="Remove" aria={`Remove ${w.title} from the watchlist`} disabled={busy.watch} onConfirm={() => setWatch({ channelId: w.channelId, remove: true })} />
          </li>
        ))}
      </ul>
      <Note k="watch" />
      <form className="mt-1 flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (input.trim() && (await onAdd(input.trim()))) setInput(""); }}>
        <input className="field min-w-0 flex-1 !px-2 !py-1 !text-xs" placeholder="Add a creator: @handle, name or channel/video link" value={input} maxLength={200} onChange={(e) => setInput(e.target.value)} aria-label="Creator to add" />
        <button type="submit" className="chip" disabled={busy.add || !input.trim()} aria-label="Add creator">{busy.add ? "Adding…" : "+ Add"}</button>
      </form>
      <Note k="add" />
      {added && !busy.add && <p className="ok mt-1 text-xs" role="status">{added}</p>}
    </div>
  );
}

/** AI niche finder: what's winning for clip channels this week, with source creators to watch. Refreshed weekly by the scout timer. */
function NicheCard({ d, busy, Note, onSave, onAdd, onResearch, onUse }: { d: ScoutData; busy: Record<string, boolean>; Note: (p: { k: string }) => ReactNode;
  onSave: (key: string, body: ScoutPatch) => Promise<boolean>; onAdd: (input: string) => Promise<boolean>; onResearch: () => void; onUse: (name: string) => void }) {
  const s = d.scout, rep = s.niche, run = s.nicheRun, watching = new Set(s.watchlist.map((w) => w.channelId));
  const inUse = (kw: string[]) => kw.length === s.aiKeywords.length && kw.every((k) => s.aiKeywords.includes(k));
  return (
    <div className="mt-2 rounded-xl border border-white/10 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <b className="flex-1 text-sm">🧭 Niche report</b>
        <button className="chip" onClick={onResearch} disabled={busy.niche || d.running || !d.configured} aria-label="Research my niche">{d.researching ? "Researching…" : "🔭 Find my niche"}</button>
      </div>
      <div className="flex flex-wrap items-center gap-x-1">
      <p className="muted num text-[11px]" aria-live="polite">
        {rep ? `Report ${when(rep.at)} · refreshes weekly${s.nicheAuto ? " · auto-applies the top niche" : ""}` : "Suggests a niche and creators to clip."}
        {run && ` · last research ${when(run.at)}, ${run.units} units`}
      </p>
        {!rep && <Help text="ORBIT reads this week's trending gaming/entertainment videos and top clip Shorts, then suggests a niche and the creators to clip (about 410 YouTube units, refreshes weekly)." />}
      </div>
      {run && !run.ok && <p className="error mt-1 text-xs" role="alert">⚠ {run.error}</p>}
      {!!run?.warnings?.length && <ul className="mt-1 space-y-0.5 text-[11px]" aria-label="Niche research notes">{run.warnings.slice(0, 4).map((w, k) => <li key={k}>{w.startsWith("Auto:") ? "✓" : "⚠"} {w}</li>)}</ul>}
      <Note k="niche" />
      {rep && (
        <ol className="mt-1 space-y-2" aria-label="Suggested niches">
          {rep.niches.map((n) => (
            <li key={n.name} className="rounded-lg border border-white/10 p-2">
              <div className="flex flex-wrap items-center gap-1">
                <b className="flex-1">{n.name}</b>
                <Status text={`score ${n.score}/100`} tone={n.score >= 70 ? "good" : undefined} />
                {inUse(n.keywords) ? <Status text="✓ Keywords in use" tone="good" /> : <button className="chip" onClick={() => onUse(n.name)} disabled={busy.niche} aria-label={`Use the niche ${n.name}`}>Use this niche</button>}
              </div>
              <p className="mt-0.5 leading-snug">{n.why}</p>
              <p className="muted text-[11px]">Keywords: {n.keywords.join(" · ")}</p>
              <ul className="mt-1 space-y-0.5" aria-label={`Creators for ${n.name}`}>
                {rep.creators.filter((c) => c.niche === n.name).map((c) => (
                  <li key={c.channelId} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1"><b>{c.title}</b> <span className="muted num">{compact(c.subscribers)} subs</span> — {c.evidence}</span>
                    {watching.has(c.channelId) ? <Status text="★ Watching" /> : <button className="chip" onClick={() => void onAdd(c.channelId)} disabled={busy.add} aria-label={`Watch ${c.title}`}>＋ Watch</button>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {!!s.aiKeywords.length && (
        <p className="mt-1 text-[11px]">AI keywords searched with yours: {s.aiKeywords.join(" · ")}{" "}
          <button className="chip" onClick={() => void onSave("aikw", { aiKeywords: [] })} disabled={busy.aikw} aria-label="Clear AI keywords">Clear</button></p>
      )}
      <Note k="aikw" />
    </div>
  );
}

function ScoutSettingsForm({ s, busy, Note, onSave }: { s: ScoutSettings; busy: Record<string, boolean>; Note: (p: { k: string }) => ReactNode;
  onSave: (key: string, body: ScoutPatch) => Promise<boolean> }) {
  const [f, setF] = useState({ keywords: s.keywords.join("\n"), maxAgeHours: s.maxAgeHours, creatorMaxAgeDays: s.creatorMaxAgeDays, minMinutes: s.minMinutes, dailyAuto: s.dailyAuto, runAt: s.runAt });
  const label = "muted mb-0.5 block text-[10px] uppercase tracking-widest";
  const numField = (k: "maxAgeHours" | "creatorMaxAgeDays" | "minMinutes" | "dailyAuto" | "runAt", name: string, min: number, max: number) => (
    <label className="w-28"><span className={label}>{name}</span>
      <input className="field w-full !px-2 !py-1 !text-xs" type="number" min={min} max={max} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: Math.round(Number(e.target.value)) }))} />
    </label>
  );
  return (
    <div id="scout-settings" className="mt-2 space-y-3 rounded-xl border border-white/10 p-2 text-xs">
      <form className="space-y-2" onSubmit={(e) => {
        e.preventDefault();
        void onSave("settings", { keywords: f.keywords.split("\n").map((k) => k.trim()).filter(Boolean), maxAgeHours: f.maxAgeHours, creatorMaxAgeDays: f.creatorMaxAgeDays, minMinutes: f.minMinutes, dailyAuto: f.dailyAuto, runAt: f.runAt });
      }}>
        <label className="block"><span className={label}>Keywords: search words to discover new creators (one per line; up to 3 searched per run, 100 units each). Channel links go under Creators.</span>
          <textarea className="field w-full !px-2 !py-1 !text-xs" rows={3} value={f.keywords} onChange={(e) => setF((x) => ({ ...x, keywords: e.target.value }))} />
        </label>
        <div className="flex flex-wrap gap-2">
          {numField("creatorMaxAgeDays", "Creator videos max age (d)", 1, 60)}{numField("maxAgeHours", "Keyword videos max age (h)", 1, 336)}{numField("minMinutes", "Min length (min)", 1, 180)}
          {numField("dailyAuto", "Auto clips/day", 0, 5)}{numField("runAt", "Daily run (hour)", 0, 23)}
        </div>
        <button type="submit" className="btn" disabled={busy.settings}>{busy.settings ? "Saving…" : "Save settings"}</button>
        <Note k="settings" />
      </form>
      <div>
        <label className="flex items-center gap-1"><input type="checkbox" checked={s.nicheAuto} disabled={busy.nicheAuto}
          onChange={(e) => void onSave("nicheAuto", { nicheAuto: e.target.checked })} /> Auto-apply the weekly niche report (its keywords + watch its creators)</label>
        <p className="muted text-[11px]">Auto-clip stays your choice per creator. <Help text="Clipping without the creator's permission risks copyright strikes." /></p>
        <Note k="nicheAuto" />
      </div>
    </div>
  );
}

function ToolsBanner({ tools }: { tools: ToolsStatus }) {
  const [copied, setCopied] = useState(false);
  const onlyTranscriber = tools.ffmpeg && !tools.transcriber;
  return (
    <div className="card text-sm" role="status" style={{ borderColor: "#fb923c" }}>
      <b>⚠ {onlyTranscriber ? "Captions are unavailable" : "Video tools are missing"}</b>
      <p className="mt-1">Missing: {tools.missing.join(", ")}.</p>
      {onlyTranscriber && <p className="mt-1">Clips still work, just without captions.</p>}
      <p className="mt-1">On the PC, run this in PowerShell:</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="num block min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-black/40 p-2 text-xs">{SETUP}</code>
        <button className="chip shrink-0" aria-label="Copy setup command" onClick={() => navigator.clipboard?.writeText(SETUP).then(() => setCopied(true), () => setCopied(false))}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function QuarantineNotice({ root, files }: { root: string; files: Quarantined[] }) {
  const sep = root.includes("\\") ? "\\" : "/";
  const dirs = [...new Set(files.map((q) => q.file.split("/").slice(0, -1).join(sep)))];
  const n = files.length;
  return (
    <div className="card text-sm" role="alert" style={{ borderColor: "#fb923c" }}>
      <b>⚠ {n === 1 ? "1 damaged job file was set aside" : `${n} damaged job files were set aside`}:</b>
      <ul className="mt-1 text-xs">{files.slice(0, 5).map((q) => <li key={q.file}><span className="num">{q.file.split("/").pop()}</span> — {q.reason}{q.at ? ` · ${when(q.at)}` : ""}</li>)}</ul>
      {n > 5 && <p className="muted text-xs">…and {n - 5} more.</p>}
      <p className="mt-1 text-xs">Moved, not deleted. They&apos;re in:</p>
      {dirs.map((d) => <code key={d} className="num mt-1 block overflow-x-auto whitespace-nowrap rounded bg-black/40 p-2 text-xs">{root}{sep}{d}</code>)}
      <p className="muted mt-1 text-xs">Move or delete them there to clear this notice.</p>
    </div>
  );
}

function Progress({ pct, step, label, reduced }: { pct: number; step: string; label: string; reduced: boolean }) {
  return (
    <div className="mt-2">
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct}% · ${step}`}
        className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,214,224,0.08)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #800f2f, #ff2e63)", transition: reduced ? "none" : "width 0.4s" }} />
      </div>
      <p className="muted mt-1 truncate text-xs leading-4" title={step}><span className="num">{pct}%</span> · {step}</p>
    </div>
  );
}

const DL_LABEL: Record<Download["status"], string> = { queued: "⏳ Queued", downloading: "⬇ Downloading", done: "✓ Downloaded", failed: "⚠ Failed" };

function AddFromLink({ tools, opts, setOpts, busy, onSubmit }: {
  tools: ToolsStatus; opts: Opts; setOpts: (f: (o: Opts) => Opts) => void; busy?: boolean;
  onSubmit: (body: { url: string; permission: string; autoClip?: Opts }) => Promise<boolean>;
}) {
  const [url, setUrl] = useState("");
  const [auto, setAuto] = useState(false);
  const okUrl = parseClipUrl(url.trim()), ch = okUrl ? channelLink(okUrl) : null; // a channel page: wrong box
  const submit = async () => {
    if (!okUrl || ch) return;
    if (await onSubmit({ url: okUrl, permission: "", ...(auto ? { autoClip: { ...opts, captions: opts.captions && tools.transcriber } } : {}) })) setUrl("");
  };
  return (
    <form className="mt-3 space-y-2 rounded-xl border border-white/10 p-2 text-xs" aria-label="Add from link" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <b className="block text-sm">🔗 Add from link</b>
      <label className="block">
        <span className="muted mb-1 block text-[10px] uppercase tracking-widest">YouTube or Twitch link</span>
        <input className="field w-full !px-2 !py-1 !text-xs" type="text" inputMode="url" maxLength={2000} placeholder="Paste a YouTube, Twitch or Kick link" value={url}
          onChange={(e) => setUrl(e.target.value)} aria-invalid={!!url.trim() && !okUrl} />
      </label>
      {!!url.trim() && !okUrl && <p className="error">That doesn&apos;t look like a YouTube, Twitch or Kick video link.</p>}
      {ch && <p className="error" role="alert">{CHANNEL_LINK_MSG[ch]}</p>}
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Make clips when it&apos;s downloaded
      </label>
      {auto && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <Choice legend="Number of clips" values={[3, 5, 8]} value={opts.count} fmt={String} onChange={(count) => setOpts((o) => ({ ...o, count }))} />
          <Choice legend="Max length" values={[30, 45, 60]} value={opts.maxSec} fmt={(v) => `${v} s`} onChange={(maxSec) => setOpts((o) => ({ ...o, maxSec }))} />
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={opts.captions && tools.transcriber} onChange={(e) => setOpts((o) => ({ ...o, captions: e.target.checked }))} disabled={!tools.transcriber} />
            Captions{!tools.transcriber ? " (needs transcriber)" : ""}
          </label>
          <EditOptions opts={opts} setOpts={setOpts} />
        </div>
      )}
      <button type="submit" className="btn" disabled={busy || !okUrl || !!ch || !tools.ytdlp || !tools.ffmpeg}>{busy ? "Adding…" : "⬇ Download"}</button>
      {!tools.ytdlp && <p>Needs yt-dlp. On the PC, run <code className="num rounded bg-black/40 px-1">{YTDLP_SETUP}</code> in PowerShell, then restart ORBIT.</p>}
    </form>
  );
}

function Conflict({ onAgain, busy }: { onAgain: () => void; busy?: boolean }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs" role="alert">
      This video already has clips. <button className="chip" onClick={onAgain} disabled={busy}>{busy ? "Starting…" : "Make again"}</button>
    </p>
  );
}

function Choice<T extends string | number>({ legend, values, value, fmt, onChange, hint }: { legend: string; values: T[]; value: T; fmt: (v: T) => string; onChange: (v: T) => void; hint?: string }) {
  return (
    <fieldset>
      <legend className="muted mb-1 text-[10px] uppercase tracking-widest">{legend}</legend>
      <div className="flex gap-1">
        {values.map((v) => <button key={v} type="button" className="chip num" aria-pressed={value === v} onClick={() => onChange(v)}>{fmt(v)}</button>)}
      </div>
      {hint && <p className="muted mt-1 text-[10px]">{hint}</p>}
    </fieldset>
  );
}

const LAYOUT: Record<Opts["layout"], [string, string]> = {
  fit: ["Fit", "Whole frame over a blurred background"],
  fill: ["Fill", "Crops the middle to full screen (facecam-centred streams)"],
  split: ["Split", "Gameplay on top, facecam below"],
};

/** Layout, pacing, zooms and language for a clip job. */
function EditOptions({ opts, setOpts }: { opts: Opts; setOpts: (f: (o: Opts) => Opts) => void }) {
  return (
    <>
      <Choice legend="Layout" values={["fit", "fill", "split"] as Opts["layout"][]} value={opts.layout} fmt={(v) => LAYOUT[v][0]} hint={LAYOUT[opts.layout][1]}
        onChange={(layout) => setOpts((o) => ({ ...o, layout }))} />
      {opts.layout === "split" && (
        <Choice legend="Facecam side" values={["left", "right"] as Opts["camSide"][]} value={opts.camSide} fmt={(v) => (v === "left" ? "Left third" : "Right third")}
          onChange={(camSide) => setOpts((o) => ({ ...o, camSide }))} />
      )}
      <Choice legend="Speech" values={["en", "auto"] as Opts["language"][]} value={opts.language} fmt={(v) => (v === "en" ? "English" : "Any language")}
        onChange={(language) => setOpts((o) => ({ ...o, language }))} />
      <label className="flex items-center gap-1.5" title="Cuts pauses of 0.7 s or more">
        <input type="checkbox" checked={opts.jumpCuts} onChange={(e) => setOpts((o) => ({ ...o, jumpCuts: e.target.checked }))} /> Jump cuts (remove dead air)
      </label>
      <label className="flex items-center gap-1.5" title="A quick zoom on the loudest moments, at most one every 6 s">
        <input type="checkbox" checked={opts.zooms} onChange={(e) => setOpts((o) => ({ ...o, zooms: e.target.checked }))} /> Zoom punch-ins
      </label>
    </>
  );
}

/* ---------- jobs & clips ---------- */

type PatchBody = { status?: "approved" | "rejected"; title?: string; reason?: string; thumb?: string };
type PatchFn = (clip: string, body: PatchBody) => Promise<boolean>;
type PublishFn = (clip: string, body: PublishBody) => Promise<boolean>;
type VersionFn = (clip: string, body: VersionBody) => Promise<boolean>;

function JobCard({ job, reduced, showRejected, busy, Note, yt, publishing, onRetry, onDelete, onPatch, onPublish, onCheck, onVersion, onTitles }: {
  job: ClipJob; publishing?: string | null; reduced: boolean; showRejected: boolean; busy: Record<string, boolean>; Note: (p: { k: string }) => ReactNode; yt: YtStatus | null;
  onRetry: () => void; onDelete: () => void; onPatch: PatchFn; onPublish: PublishFn; onCheck: (clip: string) => Promise<boolean>; onVersion: VersionFn; onTitles: (clip: string) => Promise<boolean>;
}) {
  const o = job.options; // what the original clips were rendered with (mirrors baseEdit in pure.ts)
  const base: VersionEdit = { layout: o.layout ?? "fit", camSide: o.camSide ?? "right", captions: o.captions ? "karaoke" : "none", jumpCuts: o.jumpCuts ?? true, zooms: o.zooms ?? true };
  const working = isJobActive(job), pct = Math.round(Math.min(1, Math.max(0, job.progress || 0)) * 100);
  const clips = job.clips.filter((c) => showRejected || c.status !== "rejected");
  const hidden = job.clips.length - clips.length;
  return (
    <article className="rounded-xl border border-white/10 p-2.5" aria-label={`Clip job: ${job.source}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <b className="block truncate text-sm" title={job.source}>{job.source}</b>
          <span className="muted num text-[11px]">
            {when(job.createdAt)}{job.durationSec ? ` · ${mmss(job.durationSec)} long` : ""} · {job.options.count} clips ≤ {job.options.maxSec} s{job.options.captions ? " · captions" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Status text={JOB_LABEL[job.status] ?? job.status} tone={toneOf(job.status)} />
          <ConfirmButton label="Delete" sure="Delete?" aria={`Delete job for ${job.source}`} onConfirm={onDelete} disabled={busy[`del:${job.id}`]} />
        </div>
      </div>
      <Note k={`del:${job.id}`} />

      {working && (
        <Progress pct={pct} step={job.step} label={`Progress for ${job.source}`} reduced={reduced} />
      )}

      {job.status === "done" && job.timings && (
        <p className="muted num mt-1 text-[11px]">
          Took {mmss(job.timings.audio + job.timings.transcribe + job.timings.pick + job.timings.render)}: audio {mmss(job.timings.audio)} · transcribe {mmss(job.timings.transcribe)} · pick {mmss(job.timings.pick)} · render {mmss(job.timings.render)}
        </p>
      )}

      {job.warnings.length > 0 && <ul className="mt-2 space-y-0.5 text-xs" aria-label="Warnings">{job.warnings.map((w, k) => <li key={k}>⚠ {w}</li>)}</ul>}

      {job.status === "failed" && (
        <div className="mt-2 text-sm" role="alert">
          <p className="error">{job.error || "The job failed."}</p>
          <button className="btn mt-2" onClick={onRetry} disabled={busy[`make:${job.source}`]}>{busy[`make:${job.source}`] ? "Starting…" : "Try again"}</button>
          <Note k={`make:${job.source}`} />
        </div>
      )}

      {clips.length > 0 && (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2" aria-label={`Clips from ${job.source}`}>
          {clips.map((c) => (
            <li key={c.id}>
              <ClipCard clip={c} busy={!!busy[`clip:${job.id}/${c.id}`]} onPatch={onPatch} note={<Note k={`clip:${job.id}/${c.id}`} />}
                picks={(c.status === "ready" || c.status === "approved") && <>
                  <ClipPicks clip={c} busy={!!busy[`clip:${job.id}/${c.id}`]} onPick={(body) => void onPatch(c.id, body)}
                    onMore={() => void onTitles(c.id)} moreBusy={!!busy[`titles:${job.id}/${c.id}`]} />
                  <Note k={`titles:${job.id}/${c.id}`} />
                </>}
                version={(c.status === "ready" || c.status === "approved") && !working &&
                  <VersionBox clip={c} base={c.edit ?? base} busy={!!busy[`ver:${job.id}/${c.id}`]} onVersion={onVersion} note={<Note k={`ver:${job.id}/${c.id}`} />} />}
                publish={c.status === "approved" && <PublishBox clip={c} yt={yt} reduced={reduced} busy={!!busy[`pub:${job.id}/${c.id}`]} onPublish={onPublish}
                  stale={c.publish?.status === "uploading" && publishing !== `${job.id}/${c.id}`}
                  onCheck={() => onCheck(c.id)} note={<Note k={`pub:${job.id}/${c.id}`} />} />} />
            </li>
          ))}
        </ul>
      )}
      {!clips.length && job.status === "done" && <p className="muted mt-2 text-xs">{hidden ? `All ${hidden} clips are rejected (use “Show rejected”).` : "No clips were found in this video."}</p>}
    </article>
  );
}

function ClipCard({ clip: c, busy, onPatch, note, picks, version, publish }: { clip: Clip; busy: boolean; onPatch: PatchFn; note: ReactNode; picks: ReactNode; version: ReactNode; publish: ReactNode }) {
  const [play, setPlay] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const reviewable = c.status === "ready" || c.status === "approved" || c.status === "rejected";
  const len = Math.max(0, c.end - c.start);
  const save = async () => {
    const t = edit?.trim();
    if (!t || t === c.title) { setEdit(null); return; }
    if (await onPatch(c.id, { title: t })) setEdit(null); // keep the editor open on failure
  };

  return (
    <div className="flex h-full flex-col gap-1.5 rounded-xl border border-white/10 p-1.5 text-xs" style={c.status === "approved" ? { borderColor: "#ff8fab" } : c.status === "rejected" ? { opacity: 0.6 } : undefined}>
      <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-black/50">
        {play && c.video ? (
          <video className="h-full w-full object-cover" src={media(c.video)} poster={c.thumb ? media(c.thumb) : undefined} controls playsInline preload="none" autoPlay aria-label={`Clip: ${c.title}`} />
        ) : c.video ? (
          <button className="group grid h-full w-full place-items-center rounded-lg" onClick={() => setPlay(true)} aria-label={`Play clip: ${c.title}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {c.thumb && <img src={media(c.thumb)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
            <span aria-hidden className="relative rounded-full bg-black/60 px-3 py-1.5 text-base">▶</span>
          </button>
        ) : (
          <div className="grid h-full place-items-center p-2 text-center">
            <span className={c.status === "failed" ? "error" : "muted"}>{c.status === "failed" ? `⚠ ${c.error || "Render failed"}` : "🎞 Rendering…"}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        <Status text={CLIP_LABEL[c.status] ?? c.status} tone={toneOf(c.status)} />
        {c.variantOf && <Status text={`↳ v${c.id.match(/-v(\d+)$/)?.[1] ?? "?"} of ${rootClipId(c.id).replace("clip-", "clip ")}`} />}
      </div>

      {edit != null ? (
        <form className="flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="sr-only" htmlFor={`t-${c.id}`}>Clip title</label>
          <input id={`t-${c.id}`} className="field !px-2 !py-1 !text-xs" value={edit} maxLength={120} autoFocus
            onChange={(e) => setEdit(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setEdit(null); }} />
          <div className="flex gap-1">
            <button type="submit" className="chip" disabled={busy || !edit.trim()}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className="chip" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-1">
          <b className="min-w-0 flex-1 leading-snug">{c.title}</b>
          <button className="chip shrink-0 !px-1.5 !py-0" onClick={() => setEdit(c.title)} aria-label={`Edit title: ${c.title}`}>✎</button>
        </div>
      )}
      {c.status === "ready" && picks /* while reviewing, title/thumb picks stay in view */}
      {c.hook && <p className="leading-snug">“{c.hook}”</p>}
      {c.reason && <p className="muted line-clamp-2 text-[11px] leading-snug" title={c.reason}>{c.reason}</p>}
      <p className="muted num text-[11px]">{mmss(c.start)}–{mmss(c.end)} · {mmss(len)} · score {score(c.score)}/100</p>
      {c.video && c.error && <p className="muted text-[11px] leading-snug">⚠ {c.error}</p>}

      <div className="mt-auto flex flex-wrap gap-1">
        {reviewable && (
          <>
            {c.status !== "rejected" && <button className="chip" onClick={() => onPatch(c.id, { status: "approved" })} disabled={busy || c.status === "approved"} aria-pressed={c.status === "approved"} aria-label={`Approve ${c.title}`}>✓ Approve</button>}
            {c.status !== "rejected" && <RejectButton title={c.title} onReject={(reason) => void onPatch(c.id, { status: "rejected", ...(reason ? { reason } : {}) })} disabled={busy || c.publish?.status === "uploading"} />}
          </>
        )}
      </div>
      {note}
      {publish}
      {(c.video || version || (c.status !== "ready" && picks)) && (
        <>
          <button className="chip self-start !px-2 !py-0.5 !text-[10px]" aria-expanded={more} aria-controls={`more-${c.id}`} onClick={() => setMore((m) => !m)}
            aria-label={`${more ? "Fewer" : "More"} options for ${c.title}`}>{more ? "Less ▴" : "More… ▾"}</button>
          {/* hidden, not unmounted: an open "Another version" form keeps what was typed */}
          <div id={`more-${c.id}`} hidden={!more} className="flex flex-col gap-1.5">
            {c.status !== "ready" && picks}
            {version}
            {c.video && <a className="chip self-start" href={media(c.video)} download aria-label={`Download ${c.title}`}>⬇ Download</a>}
          </div>
        </>
      )}
    </div>
  );
}

/** Reject in two clicks; while armed, a reason chip rejects in one click with that reason (optional, stored as feedback). */
function RejectButton({ title, disabled, onReject }: { title: string; disabled?: boolean; onReject: (reason?: string) => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 8000); return () => clearTimeout(t); }, [armed]);
  if (!armed) return <button className="chip" disabled={disabled} onClick={() => setArmed(true)} aria-label={`Reject ${title}`}>✕ Reject</button>;
  const go = (r?: string) => { setArmed(false); onReject(r); };
  return (
    <div role="group" aria-label={`Reject ${title}`} className="flex w-full flex-wrap items-center gap-1"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArmed(false); }}>
      <button className="chip" autoFocus style={{ borderColor: "#fb7185" }} onClick={() => go()} aria-label={`Confirm: reject ${title}`}>Sure? ✕</button>
      <span className="muted text-[10px]">or why:</span>
      {REJECT_REASONS.map((r) => <button key={r} className="chip !px-1.5 !py-0 !text-[10px]" onClick={() => go(r)} aria-label={`Reject ${title}: ${r}`}>{r}</button>)}
    </div>
  );
}

const CAPTION_LABEL: Record<CaptionStyle, string> = { karaoke: "Karaoke", classic: "Classic", none: "None" };
const signed = (n: number) => `${n > 0 ? "+" : ""}${n} s`;

type VersionForm = VersionEdit & { title: string; hook: string; start: number; end: number; suggest: boolean };
/** "Another version": same moment re-rendered with other settings, from the saved analysis (fast, no transcription). */
function VersionBox({ clip: c, base, busy, onVersion, note }: { clip: Clip; base: VersionEdit; busy: boolean; onVersion: VersionFn; note: ReactNode }) {
  const [f, setF] = useState<VersionForm | null>(null);
  if (!f) return (
    <div>
      <button className="chip" onClick={() => setF({ ...base, title: c.title, hook: c.hook, start: 0, end: 0, suggest: false })} aria-label={`Make another version of ${c.title}`}>↻ Another version</button>
      {note}
    </div>
  );
  const set = (p: Partial<VersionForm>) => setF((x) => x && { ...x, ...p });
  const nudge = (k: "start" | "end", d: number) => { const v = Math.max(-10, Math.min(10, f[k] + d)); set(k === "start" ? { start: v } : { end: v }); };
  const submit = async () => {
    const { title, hook, suggest, ...rest } = f;
    const body: VersionBody = { ...rest, suggest, ...(!suggest && title.trim() && title.trim() !== c.title ? { title: title.trim() } : {}), ...(!suggest && hook.trim() !== c.hook ? { hook: hook.trim() } : {}) };
    if (await onVersion(c.id, body)) setF(null);
  };
  const label = "muted mb-0.5 block text-[10px] uppercase tracking-widest";
  const nudgeRow = (k: "start" | "end", name: string) => ( // a plain function, not a component: re-renders keep button focus
    <div className="flex items-center gap-1">
      <span className="w-8 text-[10px]">{name}</span>
      <button type="button" className="chip !px-1.5 !py-0" onClick={() => nudge(k, -1)} disabled={f[k] <= -10} aria-label={`${name} 1 s earlier`}>−1s</button>
      <span className="num w-10 text-center text-[11px]">{signed(f[k])}</span>
      <button type="button" className="chip !px-1.5 !py-0" onClick={() => nudge(k, 1)} disabled={f[k] >= 10} aria-label={`${name} 1 s later`}>+1s</button>
    </div>
  );
  return (
    <form className="flex flex-col gap-1.5 rounded-md border border-white/10 p-1.5" aria-label={`Another version of ${c.title}`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Choice legend="Layout" values={["fit", "fill", "split"] as VersionEdit["layout"][]} value={f.layout} fmt={(v) => LAYOUT[v][0]} onChange={(layout) => set({ layout })} />
      {f.layout === "split" && <Choice legend="Facecam" values={["left", "right"] as VersionEdit["camSide"][]} value={f.camSide} fmt={(v) => (v === "left" ? "Left" : "Right")} onChange={(camSide) => set({ camSide })} />}
      <Choice legend="Captions" values={[...CAPTION_STYLES]} value={f.captions} fmt={(v) => CAPTION_LABEL[v]} onChange={(captions) => set({ captions })} />
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.jumpCuts} onChange={(e) => set({ jumpCuts: e.target.checked })} /> Jump cuts</label>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.zooms} onChange={(e) => set({ zooms: e.target.checked })} /> Zooms</label>
      <fieldset>
        <legend className={label}>Trim</legend>
        {nudgeRow("start", "Start")}{nudgeRow("end", "End")}
        <p className="muted num mt-0.5 text-[10px]">{mmss(Math.max(0, c.start + f.start))}–{mmss(c.end + f.end)}</p>
      </fieldset>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.suggest} onChange={(e) => set({ suggest: e.target.checked })} /> ✨ New title &amp; hook by Claude</label>
      {!f.suggest && (
        <>
          <label><span className={label}>Title</span><input className="field w-full !px-2 !py-1 !text-xs" value={f.title} maxLength={70} onChange={(e) => set({ title: e.target.value })} /></label>
          <label><span className={label}>Hook (first 2 s)</span><input className="field w-full !px-2 !py-1 !text-xs" value={f.hook} maxLength={40} placeholder="No hook" onChange={(e) => set({ hook: e.target.value })} /></label>
        </>
      )}
      <div className="flex gap-1">
        <button type="submit" className="chip" disabled={busy}>{busy ? "Starting…" : "↻ Render"}</button>
        <button type="button" className="chip" onClick={() => setF(null)}>Cancel</button>
      </div>
      {note}
    </form>
  );
}

const LOCKED_NOTE = "Google keeps API uploads from unverified apps private. If YouTube locks it as private, open it in YouTube Studio and set it to Public.";
const PUB_BOX = { background: "rgba(255,143,171,0.12)", color: "#ffd6e0" };
const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
type PubWhen = "now" | "next" | "pick";
const WHEN_LABEL: Record<PubWhen, string> = { now: "Now", next: "Next best slot", pick: "Pick a time" };
const MIN_LEAD = 15 * 60_000; // mirrors MIN_LEAD_MS: YouTube needs publishAt in the future, we keep a margin for the upload
/** datetime-local value ("YYYY-MM-DDTHH:mm", local time) for a Date. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function PublishBox({ clip: c, yt, reduced, busy, stale, onPublish, onCheck, note }: { clip: Clip; yt: YtStatus | null; reduced: boolean; busy: boolean; stale: boolean; onPublish: PublishFn; onCheck: () => void; note: ReactNode }) {
  const [form, setForm] = useState<PublishBody | null>(null);
  const [at, setAt] = useState("");
  const [mode, setMode] = useState<PubWhen>("now");
  const [sched, setSched] = useState<Schedule | null>(null);
  const p = c.publish;
  const unsure = p?.status === "unknown" || stale; // the last upload may be on YouTube: only an explicit "Upload again anyway" re-uploads
  const open = () => { setAt(""); setMode("now"); void api<Schedule>(`${API}/schedule`).then(setSched, () => setSched(null)); setForm({ title: c.title.replace(/[<>]/g, "").slice(0, 100), description: `${c.hook.replace(/[<>]/g, "")}\n\n#shorts`.trim(), privacy: "private" }); };
  const submit = async () => {
    if (!form) return;
    const publishAt = mode === "next" ? "next" : mode === "pick" && at ? new Date(at).toISOString() : undefined;
    if (await onPublish(c.id, { ...form, ...(publishAt ? { publishAt } : {}), ...(unsure ? { force: true } : {}) })) setForm(null);
  };
  const reconnect = (text: string) => <p className="rounded-md px-1.5 py-1 text-[11px]" style={PUB_BOX}>{text} <a className="underline" href="/api/studio/oauth/start">Connect YouTube</a></p>;

  if (p?.status === "uploading" && !stale) {
    return <Progress pct={Math.round(Math.min(1, Math.max(0, p.progress ?? 0)) * 100)} step="Uploading to YouTube" label={`Upload progress for ${c.title}`} reduced={reduced} />;
  }
  if (p?.status === "done" && p.videoId) {
    return (
      <div className="space-y-1 rounded-md px-1.5 py-1 text-[11px]" style={PUB_BOX} role="status">
        <p>✓ On YouTube{p.privacy ? ` · ${p.privacy}` : ""}</p>
        <a className="block underline" href={`https://youtube.com/shorts/${p.videoId}`} {...ext}>Open on YouTube ↗</a>
        <a className="block underline" href={`https://studio.youtube.com/video/${p.videoId}/edit`} {...ext}>Open in YouTube Studio ↗</a>
        <p className="muted">Stuck on private? <Help text={LOCKED_NOTE} /></p>
      </div>
    );
  }
  if (p?.status === "scheduled" && p.videoId) {
    const live = !!p.scheduledFor && Date.parse(p.scheduledFor) <= Date.now();
    return (
      <div className="space-y-1 rounded-md px-1.5 py-1 text-[11px]" style={PUB_BOX} role="status">
        <p>{live ? `✓ Live since ${when(p.scheduledFor!)}` : `🕒 Goes live ${p.scheduledFor ? when(p.scheduledFor) : "at the scheduled time"}`}</p>
        <a className="block underline" href={`https://youtube.com/shorts/${p.videoId}`} {...ext}>Open on YouTube ↗</a>
        <a className="block underline" href={`https://studio.youtube.com/video/${p.videoId}/edit`} {...ext}>{live ? "Open in YouTube Studio ↗" : "Reschedule or unschedule in YouTube Studio ↗"}</a>
        {!live && <p className="muted">Change the time in YouTube Studio. <Help text="ORBIT can upload but not edit videos, so change the time in YouTube Studio (Visibility → Schedule)." /></p>}
      </div>
    );
  }
  if (unsure && !form) { // no plain retry: it could duplicate the video
    return (
      <div className="space-y-1 rounded-md px-1.5 py-1 text-[11px]" style={PUB_BOX} role="status">
        <p>⏳ {(p?.status === "unknown" && p.error) || "Outcome unknown — check YouTube"}</p>
        {!yt?.connected && reconnect("Checking needs YouTube connected.")}
        <div className="flex flex-wrap gap-1">
          <button className="chip" onClick={onCheck} disabled={busy} aria-label={`Check YouTube for ${c.title}`}>{busy ? "Checking…" : "🔍 Check YouTube"}</button>
          {yt?.canUpload && <ConfirmButton label="Upload again anyway" sure="Could duplicate — sure?" aria={`Upload ${c.title} again even though it may already be on YouTube`} onConfirm={open} disabled={busy} />}
        </div>
        {note}
      </div>
    );
  }
  if (yt && !yt.configured) return <p className="muted text-xs">YouTube sign-in isn&apos;t set up: add YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET to .env.local.</p>;
  if (!yt?.connected) return reconnect("YouTube isn't connected.");
  if (!yt.canUpload) return reconnect("Reconnect YouTube to allow uploads.");
  if (!form) {
    return (
      <div className="space-y-1">
        {p?.status === "failed" && <p className="error text-[11px]" role="alert">⚠ {p.error || "The upload failed."}</p>}
        <button className="chip" onClick={open} aria-label={`Publish ${c.title} to YouTube`}>{p?.status === "failed" ? "↻ Try publishing again" : "▶ Publish"}</button>
        {note}
      </div>
    );
  }
  const set = (patch: Partial<PublishBody>) => setForm((f) => f && { ...f, ...patch });
  const label = "muted mb-0.5 block text-[10px] uppercase tracking-widest";
  const tooSoon = mode === "pick" && !!at && new Date(at).getTime() < Date.now() + MIN_LEAD;
  return (
    <form className="flex flex-col gap-1.5 rounded-md border border-white/10 p-1.5" aria-label={`Publish ${c.title} to YouTube`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label><span className={label}>Title</span>
        <input className="field w-full !px-2 !py-1 !text-xs" value={form.title} maxLength={100} required onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label><span className={label}>Description</span>
        <textarea className="field w-full !px-2 !py-1 !text-xs" rows={3} value={form.description} maxLength={5000} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <label><span className={label}>Visibility</span>
        <select className="field w-full !px-2 !py-1 !text-xs" value={mode === "now" ? form.privacy : "private"} disabled={mode !== "now"} onChange={(e) => set({ privacy: e.target.value as PublishBody["privacy"] })}>
          <option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option>
        </select>
      </label>
      <Choice legend="When" values={["now", "next", "pick"] as PubWhen[]} value={mode} fmt={(v) => WHEN_LABEL[v]} onChange={setMode} />
      {mode === "next" && <p className="muted text-[11px]">{sched ? (sched.next[0] ? `Next free slot: ${when(sched.next[0])}` : "No free slot in the next 6 months — edit your slots.") : "Finding the next free slot…"}</p>}
      {mode === "pick" && (
        <label><span className="sr-only">Publish time</span>
          <input className="field w-full !px-2 !py-1 !text-xs" type="datetime-local" value={at} min={localInput(new Date(Date.now() + MIN_LEAD))} required onChange={(e) => setAt(e.target.value)} />
        </label>
      )}
      {tooSoon && <p className="error text-[11px]">Pick a time at least 15 minutes from now.</p>}
      {mode !== "now" && <p className="muted text-[11px]">Uploads now as private; YouTube makes it public at that time, even if this PC is off.</p>}
      {mode !== "now" && sched && <SlotSettings sched={sched} onSaved={setSched} />}
      {/[<>]/.test(form.title + form.description) && <p className="error text-[11px]">YouTube doesn&apos;t allow &lt; or &gt;.</p>}
      <p className="muted text-[11px]">YouTube may keep it private. <Help text={LOCKED_NOTE} /></p>
      <div className="flex gap-1">
        <button type="submit" className="chip" disabled={busy || !form.title.trim() || /[<>]/.test(form.title + form.description) || (mode === "pick" && (!at || tooSoon))}>{busy ? "Starting…" : mode === "now" ? "▶ Upload" : "🕒 Schedule"}</button>
        <button type="button" className="chip" onClick={() => setForm(null)}>Cancel</button>
      </div>
      {note}
    </form>
  );
}

/** "Slots: 12:00, 17:00, 21:00 · edit" — the owner's publishing slots (in their time zone), edited inline inside the publish form. */
function SlotSettings({ sched, onSaved }: { sched: Schedule; onSaved: (s: Schedule) => void }) {
  const [edit, setEdit] = useState<{ slots: string; perDay: number; timezone: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const s = sched.settings, local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!edit) return (
    <p className="muted text-[11px]">
      Slots: {s.slots.join(", ")}{s.perDay < s.slots.length ? ` · max ${s.perDay}/day` : ""}{s.timezone !== local ? ` (${s.timezone})` : ""} ·{" "}
      <button type="button" className="underline" onClick={() => setEdit({ slots: s.slots.join(", "), perDay: s.perDay, timezone: s.timezone })} aria-label="Edit publishing slots">edit</button>
    </p>
  );
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api<Pick<Schedule, "settings" | "next">>(`${API}/schedule`, { method: "PUT", body: { timezone: edit.timezone.trim(), slots: edit.slots.split(/[\s,]+/).filter(Boolean), perDay: edit.perDay } });
      onSaved({ ...sched, ...r }); setEdit(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save the slots"); }
    finally { setBusy(false); }
  };
  const enter = (e: { key: string; preventDefault: () => void }) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }; // inside the publish form: don't upload
  const field = "field w-full !px-2 !py-1 !text-xs", label = "muted mb-0.5 block text-[10px] uppercase tracking-widest";
  return (
    <fieldset className="flex flex-col gap-1 rounded-md border border-white/10 p-1.5">
      <legend className={label}>Publishing slots</legend>
      <label><span className={label}>Times (HH:MM)</span><input className={field} value={edit.slots} onKeyDown={enter} onChange={(e) => setEdit({ ...edit, slots: e.target.value })} placeholder="12:00, 17:00, 21:00" /></label>
      <label><span className={label}>Clips per day</span><input className={field} type="number" min={1} max={12} value={edit.perDay} onKeyDown={enter} onChange={(e) => setEdit({ ...edit, perDay: Number(e.target.value) })} /></label>
      <label><span className={label}>Time zone</span><input className={field} value={edit.timezone} onKeyDown={enter} onChange={(e) => setEdit({ ...edit, timezone: e.target.value })} placeholder="Europe/Tallinn" /></label>
      {err && <p className="error text-[11px]" role="alert">{err}</p>}
      <div className="flex gap-1">
        <button type="button" className="chip" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="chip" onClick={() => setEdit(null)}>Cancel</button>
      </div>
    </fieldset>
  );
}

/** "Schedule all approved": the server uploads every approved, unpublished clip into the next free slots, one at a time. */
function ScheduleAll({ count, canUpload, onChange }: { count: number; canUpload: boolean; onChange: (quiet?: boolean) => void }) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [mine, setMine] = useState(false); // only show a result for a run seen in this panel
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<Schedule>(`${API}/schedule`).then((s) => { setBatch(s.batch); if (s.batch?.running) setMine(true); }, () => {}); }, []);
  useEffect(() => {
    if (!batch?.running) return;
    const t = setInterval(() => void api<Schedule>(`${API}/schedule`).then((s) => { setBatch(s.batch); onChange(true); }, () => {}), 2000);
    return () => clearInterval(t);
  }, [batch?.running, onChange]);
  const start = async () => {
    setBusy(true); setErr("");
    try { setBatch((await api<{ batch: Batch }>(`${API}/schedule`, { method: "POST" })).batch); setMine(true); onChange(true); }
    catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start scheduling");
      if (e instanceof HttpError && e.status === 409) { // maybe already running (another tab): pick up its progress
        const s = await api<Schedule>(`${API}/schedule`).catch(() => null);
        if (s?.batch?.running) { setBatch(s.batch); setMine(true); setErr(""); }
      }
    }
    finally { setBusy(false); }
  };
  if (batch?.running) return <span className="muted text-[11px]" aria-live="polite">🕒 Scheduling {Math.min(batch.scheduled + 1, batch.total)}/{batch.total}…</span>;
  return (
    <div className="flex flex-col items-end gap-0.5">
      {count > 0 && canUpload && <ConfirmButton id="schedule-all" className="btn !px-3 !py-1 !text-xs" label={`🕒 Schedule all approved (${count})`} sure={`Upload ${count} into the next slots?`} aria={`Schedule all ${count} approved clips into the next free slots`} onConfirm={() => void start()} disabled={busy} />}
      {mine && batch && (batch.error
        ? <p className="error text-[11px]" role="alert">{batch.scheduled} scheduled. {batch.error}</p>
        : <p className="ok text-[11px]" role="status">✓ {batch.scheduled} scheduled</p>)}
      {err && <p className="error text-[11px]" role="alert">{err}</p>}
    </div>
  );
}
