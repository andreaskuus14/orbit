"use client";
import { OrbitThinks } from "./OrbitThinks";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CAM_NAME, CAPTION_STYLES, CHANNEL_LINK_MSG, LAYOUT_NAME, REJECT_REASONS, bytes, channelLink, isJobActive, layoutText, mmss, parseClipUrl, rootClipId } from "@/lib/clips/format";
import ReviewQueue from "./ReviewQueue";
import { useWorldPaused } from "./world-paused";
import { useT } from "./i18n";
import { ACK_EVENT, ACK_KEY, failureGroups, isSkip, parseAck, type AckState } from "@/lib/clips/failure-alert-pure";
import ClipPicks from "./ClipPicks";
import LearnedCard from "./LearnedCard";
import AutopilotPanel from "./AutopilotPanel";
import StoryPanel from "./StoryPanel";
import EngageCard, { DescribeButton } from "./EngageCard";
import StudioCalendar from "./StudioCalendar";
import ShortsBoard from "./ShortsBoard";
import LongformPanel from "./LongformPanel";
import type { Open } from "@/lib/clips/pipeline-pure";
import { devlogHashtags } from "@/lib/clips/devlog";
import { HypeWave, ScoreRing, ScoreWhy } from "./HypeScore";
import type { HypeView } from "@/lib/clips/hype-pure";
import type { Virality } from "@/lib/clips/score-pure";
import { uploadHealth } from "@/lib/clips/publish-checks-pure";

// STUDIO clip factory: turn long videos from the inbox folder into 9:16 short clips, review and approve them.
// Data: /api/studio/clips (server owned elsewhere). Mounted inside `.studio`, fills its container like StudioStats.

// Mirrors src/lib/clips/types.ts (declared here so this file stands alone).
type ClipStatus = "rendering" | "ready" | "failed" | "approved" | "rejected";
type Clip = { id: string; start: number; end: number; title: string; hook: string; reason: string; score: number;
  retryOf?: { videoId: string; title: string }; notes?: string[];
  status: ClipStatus; video?: string; thumb?: string; error?: string; publish?: ClipPublish; variantOf?: string; edit?: VersionEdit; original?: string;
  titleOptions?: { text: string; score: number }[]; thumbOptions?: string[]; virality?: Virality; hookLab?: { of: string; label: string; pattern: string } };
// Mirrors GET …/[job]/[clip]/hooklab (src/lib/clips/hooklab.ts).
type HookLabRank = { ranked: { id: string; label: string; pattern: string; hook: string; score: number; why: string[] }[]; winner?: string; why: string; pending: number; total: number };
type ClipPublish = { status: "uploading" | "done" | "scheduled" | "failed" | "unknown"; progress?: number; videoId?: string; url?: string; privacy?: string; error?: string; at: string; scheduledFor?: string };
// Mirrors src/lib/clips/schedule.ts + publish-schedule.ts (GET /api/studio/clips/schedule).
type PubSettings = { timezone: string; slots: string[]; perDay: number };
type Batch = { running: boolean; total: number; scheduled: number; error?: string; at: string };
type Schedule = { settings: PubSettings; next: string[]; batch: Batch | null };
type CaptionStyle = (typeof CAPTION_STYLES)[number];
type VersionEdit = { layout: "fit" | "fill" | "split" | "follow"; camSide: CamSide; camSize?: number; captions: CaptionStyle; jumpCuts: boolean; zooms: boolean;
  coldOpen?: boolean; progressBar?: boolean; loopEnd?: boolean };
type VersionBody = Partial<VersionEdit> & { hook?: string; title?: string; original?: string; start: number; end: number; suggest: boolean };
type Quarantined = { file: string; reason: string; at: string };
type YtStatus = { configured: boolean; connected: boolean; canUpload?: boolean };
type PublishBody = { title: string; description: string; privacy: "private" | "unlisted" | "public"; publishAt?: string; force?: boolean;
  original?: string; aiContent?: boolean }; // original: "What I added" (required for other creators' clips); aiContent: YouTube's altered/synthetic label // publishAt: ISO, or "next" = next free slot
type JobStatus = "queued" | "probing" | "transcribing" | "finding" | "rendering" | "done" | "failed";
type ClipJob = { id: string; source: string; createdAt: string; updatedAt: string; status: JobStatus; progress: number; step: string;
  durationSec?: number; error?: string; warnings: string[]; clips: Clip[]; options: ClipOptions;
  timings?: { audio: number; transcribe: number; pick: number; render: number }; hype?: HypeView };
type CamSide = "left" | "right" | "tl" | "tr" | "bl" | "br";
type ClipOptions = { count: number; maxSec: number; captions: boolean; layout?: VersionEdit["layout"]; camSide?: CamSide; camSize?: number;
  jumpCuts?: boolean; zooms?: boolean; language?: "auto" | "en"; coldOpen?: boolean; progressBar?: boolean; loopEnd?: boolean; preset?: "viral" | "devlog" };
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

type Tab = "pipeline" | "find" | "clips" | "story" | "longform" | "calendar" | "insights" | "autopilot";
const TAB_KEY = "orbit.clipFactory.tab";
const readTab = (): Tab | null => {
  try { const t = localStorage.getItem(TAB_KEY); return t === "pipeline" || t === "find" || t === "clips" || t === "story" || t === "longform" || t === "calendar" || t === "insights" || t === "autopilot" ? t : null; }
  catch { return null; } // storage unavailable (or server render)
};

/** "(?)": a long explanation behind a small button; hover shows it as a tooltip, click/tap/keyboard toggles it inline. */
function Help({ text }: { text: string }) {
  const { t: tr } = useT();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      {/* 24px hit target (40px on touch) around a 16px circle; negative margin keeps the text line height */}
      <button type="button" className="muted -my-1 inline-grid h-6 w-6 place-items-center rounded-full align-middle pointer-coarse:-m-2 pointer-coarse:h-10 pointer-coarse:w-10"
        title={text} aria-label={tr("cf.moreInfo")} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
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
function ConfirmButton({ id, label, sure, aria, onConfirm, disabled, className = "chip" }: { id?: string; label: string; sure?: string; aria: string; onConfirm: () => void; disabled?: boolean; className?: string }) {
  const { t: tr } = useT();
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return (
    <button id={id} className={className} disabled={disabled} onBlur={() => setArmed(false)} aria-label={armed ? tr("cf.confirmAria", { aria }) : aria}
      style={armed ? { borderColor: "#fb7185" } : undefined} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? sure ?? tr("cf.sure") : label}
    </button>
  );
}

/* ---------- panel ---------- */

const seenReview = new WeakSet<object>();
export default function ClipFactory({ reduced, onClose, review, failed }: { reduced: boolean; onClose?: () => void; review?: object | null /* a new object opens the morning review */; failed?: object | null /* a new object opens the Failed list */ }) {
  const { t: tr, tn } = useT();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<Record<string, ClipOptions>>({}); // source → options that got a 409
  const [form, setForm] = useState<string | null>(null);
  const [opts, setOpts] = useState<Opts>({ count: 5, maxSec: 45, captions: true, layout: "follow", camSide: "right", camSize: 0.3, jumpCuts: true, zooms: true, language: "en", coldOpen: true, progressBar: false, loopEnd: true, preset: "viral" });
  const [showRejected, setShowRejected] = useState(false);
  const [docVisible, setVisible] = useState(true);
  const paused = useWorldPaused(), visible = docVisible && !paused; // STUDIO kept but hidden: no polling
  const [yt, setYt] = useState<YtStatus | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null); // null until the first load picks one
  const [autoInbox, setAutoInbox] = useState<boolean | null>(null); // null: not loaded (or the settings file is locked)
  const [autoOpts, setAutoOpts] = useState<Opts | null>(null); // what auto-clip uses (saved when it was turned on)
  const [storySeed, setStorySeed] = useState<{ idea?: string; story?: string } | null>(null); // Pipeline card → AI Story (a new object each time)
  const [scoutRun, setScoutRun] = useState(0); // bumped by the "Find videos" next step: ScoutSection runs the scout
  // Each review request opens once; the same object lingers in Orbit's state until STUDIO is left.
  useEffect(() => { if (review && !seenReview.has(review)) { seenReview.add(review); setReviewing(true); } }, [review]);
  const [showFailed, setShowFailed] = useState(false);
  const [ack, setAck] = useState<AckState>({ acked: [], shown: {} });
  useEffect(() => { try { setAck(parseAck(localStorage.getItem(ACK_KEY))); } catch { /* storage unavailable */ } }, []);
  useEffect(() => { if (failed && !seenReview.has(failed)) { seenReview.add(failed); setTab("clips"); setShowFailed(true); } }, [failed]);
  const dismiss = (keys: string[]) => {
    let cur = ack;
    try { cur = parseAck(localStorage.getItem(ACK_KEY)); } catch { /* use what we have */ }
    const next = { ...cur, acked: [...cur.acked, ...keys].slice(-500) };
    setAck(next);
    try { localStorage.setItem(ACK_KEY, JSON.stringify(next)); } catch { /* dismissed for this session only */ }
    dispatchEvent(new Event(ACK_EVENT));
  };
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
  useEffect(() => { if (!paused) void load(); }, [load, paused]); // each STUDIO visit refreshes, as a remount did
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
    const t = setInterval(() => { if (!document.hidden) void load(true); }, 2000);
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
  const moreTitles = (job: string, clip: string, review = false) => act(`titles:${job}/${clip}`, async () => { // review: the title critics instead of new options
    putClip(job, clip, (await api<{ clip: Clip }>(`${clipUrl(job, clip)}/titles`, { method: "POST", ...(review && { body: { action: "review" } }) })).clip);
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

  const gotAuto = (s: { enabled: boolean; options: Opts }) => { setAutoInbox(s.enabled); setAutoOpts(s.options); };
  useEffect(() => { void api<{ enabled: boolean; options: Opts }>(`${API}/inbox-auto`).then(gotAuto, () => setAutoInbox(null)); }, []);
  // The watcher starts jobs on its own: look for them every 30 s while nothing else is polling.
  useEffect(() => {
    if (!autoInbox || !visible || active) return;
    const t = setInterval(() => void load(true), 30_000);
    return () => clearInterval(t);
  }, [autoInbox, visible, active, load]);
  // Turning it on saves the current clip settings as the auto-clip defaults.
  const toggleAuto = (enabled: boolean) => act("auto", async () => {
    gotAuto(await api<{ enabled: boolean; options: Opts }>(`${API}/inbox-auto`, { method: "POST", body: { enabled, ...opts, preset: "viral", captions: opts.captions && !!data?.tools.transcriber } }));
  });
  const setAutoLayout = (p: Partial<Opts>) => autoOpts && act("auto", async () => {
    gotAuto(await api<{ enabled: boolean; options: Opts }>(`${API}/inbox-auto`, { method: "POST", body: { ...autoOpts, ...p, enabled: !!autoInbox } })); // also the scout's layout: never switches auto-clip on
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
  const health = data ? uploadHealth(data.jobs) : [];
  const fails = data ? failureGroups(data, ack) : [];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const workText = workingJobs.length ? `⏳ ${plural(workingJobs.length, "job")} working… ${avg(workingJobs.map((j) => j.progress))}%`
    : dls.length ? `⬇ ${plural(dls.length, "download")}… ${avg(dls.map((d) => d.progress))}%` : "";
  const workNext = <button className="chip num" onClick={() => selectTab(workingJobs.length ? "clips" : "find")} aria-label={`${workText}. Show progress`}>{workText}</button>;
  // Calendar card → the clip's card in the Clips tab (ids set in JobCard).
  const openClip = (job: string, clip: string) => { selectTab("clips"); requestAnimationFrame(() => { const el = document.getElementById(`cf-clip-${job}/${clip}`); el?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" }); el?.focus({ preventScroll: true }); }); };
  // Pipeline card → the existing tool for its stage.
  const openStage = (o: Open) => {
    if (o.tool === "review") return setReviewing(true);
    if (o.tool === "calendar") return selectTab("calendar");
    if (o.tool === "clip") return o.clip ? openClip(o.job, o.clip) : selectTab("clips");
    setStorySeed("idea" in o ? { idea: o.idea } : { story: o.story }); selectTab("story");
    requestAnimationFrame(() => document.getElementById("idea" in o ? "story-idea" : "cf-tab-story")?.focus());
  };
  const goSchedule = () => { selectTab("clips"); requestAnimationFrame(() => document.getElementById("schedule-all")?.focus()); };
  // One obvious next step, in priority order: review > schedule > connect YouTube > wait for work > find videos.
  const next = fresh ? <button className="btn" onClick={() => setReviewing(true)} aria-label={tr("cf.reviewAria", { n: fresh })}>☀ {tn("cf.readyReview", fresh)}</button>
    : unpublished && yt?.canUpload ? <button className="btn" onClick={goSchedule} aria-label={tr("cf.scheduleAllAria", { n: unpublished })}>🕒 {tr("cf.approvedSchedule", { n: unpublished })}</button>
    : unpublished && yt?.configured ? <a className="btn" href="/api/studio/oauth/start">🔗 {tr("cf.connectToPublish", { n: unpublished })}</a>
    : workText ? workNext
    : <button className="btn" onClick={() => { selectTab("find"); setScoutRun((n) => n + 1); }} aria-label={tr("cf.findAria")}>🔭 {tr("cf.findVideos")}</button>;
  const tabs: [Tab, string][] = [["pipeline", `▦ ${tr("cf.tab.pipeline")}`], ["find", `🔭 ${tr("cf.findVideos")}`], ["clips", `🎬 ${tr("cf.tab.clips")}${fresh ? tr("cf.tab.new", { n: fresh }) : ""}`], ["story", `✨ ${tr("cf.tab.story")}`], ["longform", `🎞 ${tr("cf.tab.longform")}`], ["calendar", `📅 ${tr("cf.tab.calendar")}`], ["insights", `🧠 ${tr("cf.tab.insights")}`], ["autopilot", `🤖 ${tr("cf.tab.autopilot")}`]];
  const onTabKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const t = tabs[(tabs.findIndex(([id]) => id === shown) + d + tabs.length) % tabs.length][0];
    selectTab(t); document.getElementById(`cf-tab-${t}`)?.focus();
  };

  return (
    <div className={`studio-clips glass @container h-full w-full overflow-y-auto p-3 sm:p-4 ${reduced ? "" : "panel-in"}`} role="region" aria-label={tr("cf.title")} aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="hud-title studio-title truncate">{tr("cf.title").toUpperCase()}</h2>
        <div className="flex items-center gap-2">
          <button className="chip" onClick={() => { void load(); void loadYt(); }} disabled={loading} aria-label={tr(loading ? "cf.refreshing" : "cf.refreshAria")}>↻ {tr("cf.refresh")}</button>
          {onClose && <button className="chip" onClick={onClose} aria-label={tr("cf.close")}>×</button>}
        </div>
      </div>

      {err && (
        <div className="card mt-3 text-sm" role="alert">
          <p className="error">{err}</p>
          <button className="btn mt-2" onClick={() => load()} disabled={loading}>{tr("task.retry")}</button>
        </div>
      )}

      {loading && !data && !err && (
        <div className="mt-3 space-y-3" role="status" aria-label={tr("cf.loading")}><span className="sr-only">{tr("common.loading")}</span>
          <Skeleton h={120} reduced={reduced} /><Skeleton h={90} reduced={reduced} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">{Array.from({ length: 4 }, (_, k) => <Skeleton key={k} h={260} reduced={reduced} />)}</div>
        </div>
      )}

      {data && (
        <div className="mt-3 space-y-3">
          <section className="card flex min-h-[3.25rem] flex-wrap items-center gap-x-3 gap-y-1.5" aria-label={tr("cf.nextStep")}>
            <span className="muted text-[10px] uppercase tracking-widest">{tr("cf.next")}</span>
            {next}
            {workText && next !== workNext && <span className="muted num text-[11px]">{workText}</span>}
            <span className="sr-only" aria-live="polite">{active ? tr("cf.working") : ""}</span>{/* no % here: it would be re-announced every poll */}
          </section>

          {health.length > 0 && (
            <section className="card text-[11px]" aria-label={tr("cf.uploadHealth")} role="status">
              <ul className="space-y-1">{health.map((h) => <li key={h}><span aria-hidden>⚠ </span>{h}</li>)}</ul>
            </section>
          )}
          {(!data.tools.ffmpeg || !data.tools.transcriber) && <ToolsBanner tools={data.tools} />}
          {!!data.quarantined?.length && <QuarantineNotice root={data.root} files={data.quarantined} />}

          <div role="tablist" aria-label={tr("cf.sections")} className="flex flex-wrap gap-1.5" onKeyDown={onTabKey}>
            {tabs.map(([id, text]) => (
              <button key={id} id={`cf-tab-${id}`} role="tab" className="chip !px-3 !py-1" aria-selected={shown === id} aria-controls={`cf-panel-${id}`}
                tabIndex={shown === id ? 0 : -1} onClick={() => selectTab(id)}>{text}</button>
            ))}
          </div>

          {/* Panels stay mounted (hidden) so forms, polling and scroll state survive switching tabs. */}
          <div id="cf-panel-pipeline" role="tabpanel" aria-labelledby="cf-tab-pipeline" hidden={shown !== "pipeline"}>
            {shown === "pipeline" && <ShortsBoard jobs={data.jobs} active reduced={reduced} onOpen={openStage}
              onPickTitle={(job, clip, title) => patchClip(job, clip, { title })} onMoreTitles={(job, clip) => moreTitles(job, clip)} />}
          </div>
          <div id="cf-panel-autopilot" role="tabpanel" aria-labelledby="cf-tab-autopilot" hidden={shown !== "autopilot"}><AutopilotPanel active={shown === "autopilot"} onChanged={() => void load(true)} onOpenClip={openClip} onOpenFind={() => selectTab("find")} /></div>
          <div id="cf-panel-story" role="tabpanel" aria-labelledby="cf-tab-story" hidden={shown !== "story"}><StoryPanel active={shown === "story"} seed={storySeed} onOpenClip={openClip} onChanged={() => void load(true)} /></div>
          <div id="cf-panel-longform" role="tabpanel" aria-labelledby="cf-tab-longform" hidden={shown !== "longform"}><LongformPanel active={shown === "longform"} onOpen={openStage} /></div>
          <div id="cf-panel-insights" role="tabpanel" aria-labelledby="cf-tab-insights" hidden={shown !== "insights"} className="space-y-3">
            <LearnedCard defaultOpen />
            <EngageCard />
          </div>

          <div id="cf-panel-calendar" role="tabpanel" aria-labelledby="cf-tab-calendar" hidden={shown !== "calendar"} className="space-y-3">
            {shown === "calendar" && <StudioCalendar jobs={data.jobs} waiting={unpublished} onOpen={openClip}
              scheduleAll={yt?.canUpload ? <button className="btn" onClick={goSchedule}>🕒 {tr("cf.scheduleAll")}</button> /* the one ScheduleAll lives in Clips (it polls) */ : unpublished > 0 && yt?.configured ? <a className="chip" href="/api/studio/oauth/start">🔗 {tr("cf.connectYt")}</a> : null} />}
          </div>

          <div id="cf-panel-find" role="tabpanel" aria-labelledby="cf-tab-find" hidden={shown !== "find"} className="space-y-3">
          <ScoutSection visible={visible} onQueued={() => void load(true)} runSignal={scoutRun} reduced={reduced}
            layout={autoOpts && <LayoutChip o={autoOpts} onSave={(p) => void setAutoLayout(p)} />} />

          <Section title={tr("cf.inbox")}>
            <p className="text-sm">{tr("cf.inboxDrop")}</p>
            <code className="num mt-1 block overflow-x-auto whitespace-nowrap rounded bg-black/40 p-2 text-xs">{data.root}</code>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button className="chip" onClick={openFolder} disabled={busy.open}>{busy.open ? tr("cf.opening") : `📂 ${tr("cf.openInbox")}`}</button>
              {notes.opened && !notes.open && <span className="ok text-xs" role="status">{notes.opened}</span>}
            </div>
            <Note k="open" />
            <label className="mt-2 flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={!!autoInbox} disabled={autoInbox === null || busy.auto} onChange={(e) => void toggleAuto(e.target.checked)} />
              {tr("cf.autoInbox")} <Help text={tr("cf.autoInboxHelp")} />
            </label>
            {autoInbox && autoOpts && <LayoutChip o={autoOpts} onSave={(p) => void setAutoLayout(p)} />}
            <Note k="auto" />
            <p className="muted mt-1 text-xs">{tr("cf.putStreams")}</p>
            <p className="muted mt-2 text-xs">{tr("cf.onlyAllowed")} <Help text={tr("cf.onlyAllowedHelp")} /></p>

            <AddFromLink tools={data.tools} opts={opts} setOpts={setOpts} busy={busy.dl} onSubmit={(body) => download(body)} />
            <Note k="dl" />
            {(data.downloads ?? []).length > 0 && (
              <ul className="mt-2 space-y-2" aria-label={tr("cf.downloads")}>
                {data.downloads.map((d) => (
                  <li key={d.id} className="rounded-xl border border-white/10 p-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b className="min-w-0 flex-1 truncate" title={d.url}>{d.file ?? d.url}</b>
                      <div className="flex items-center gap-1.5">
                        <Status text={DL_LABEL[d.status]} tone={toneOf(d.status)} />
                        <ConfirmButton label={tr(d.status === "queued" || d.status === "downloading" ? "common.cancel" : "common.remove")} aria={tr("cf.removeDl", { url: d.url })}
                          onConfirm={() => void delDownload(d.id)} disabled={busy[`dl:${d.id}`]} />
                      </div>
                    </div>
                    {d.status === "downloading" && <Progress pct={Math.round(d.progress * 100)} step={d.step} label={`Download progress for ${d.url}`} reduced={reduced} />}
                    {d.status === "failed" && (
                      <div className="mt-1" role="alert">
                        <p className="error">{d.error || tr("cf.dlFailed")}</p>
                        <button className="btn mt-1" disabled={busy[`dl:${d.id}`] || !data.tools.ytdlp}
                          onClick={() => void download({ url: d.url, permission: d.permission, ...(d.autoClip ? { autoClip: d.autoClip } : {}) }, d.id)}>
                          {busy[`dl:${d.id}`] ? tr("cf.starting") : tr("task.retry")}
                        </button>
                      </div>
                    )}
                    <Note k={`dl:${d.id}`} />
                  </li>
                ))}
              </ul>
            )}

            {!data.inbox.length ? (
              <Empty text={tr("cf.inboxEmpty")} action={<button className="chip" onClick={() => void load()} disabled={loading}>↻ {tr("cf.refresh")}</button>} />
            ) : (
              <ul className="mt-3 space-y-2" aria-label={tr("cf.inboxVideos")}>
                {data.inbox.map((f) => {
                  const job = f.jobId ? byId.get(f.jobId) : undefined, k = `make:${f.name}`, fid = `clipform-${f.name.replace(/[^\w-]/g, "_")}`;
                  return (
                    <li key={f.name} className="rounded-xl border border-white/10 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <b className="block truncate text-sm" title={f.name}>{f.name}</b>
                          <span className="muted num text-[11px]">{bytes(f.size)} · {when(f.mtime)}</span>
                          {f.permission && <span className="muted block truncate text-[11px]" title={f.permission}>{tr("cf.permission")} {f.permission}</span>}
                        </div>
                        {f.jobId ? (
                          job ? <Status text={JOB_LABEL[job.status] ?? job.status} tone={toneOf(job.status)} /> : <Status text={tr("cf.hasJob")} />
                        ) : (
                          <button className="chip" aria-expanded={form === f.name} aria-controls={fid} onClick={() => setForm((c) => (c === f.name ? null : f.name))}
                            aria-label={tr("cf.makeFrom", { name: f.name })}>🎬 {tr("cf.makeClips")}</button>
                        )}
                      </div>
                      {form === f.name && !f.jobId && (
                        <form id={fid} className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2 text-xs" onSubmit={(e) => { e.preventDefault(); void make(f.name, { ...opts, captions: opts.captions && data.tools.transcriber }); }}>
                          <Choice legend={tr("cf.style")} values={["viral", "devlog"] as Opts["preset"][]} value={opts.preset} fmt={(v) => (v === "devlog" ? "🛠 Devlog" : `🔥 ${tr("cf.highlights")}`)}
                            hint={opts.preset === "devlog" ? tr("cf.devlogHint") : undefined}
                            onChange={(preset) => setOpts((o) => ({ ...o, preset, ...(preset === "devlog" ? { count: 3, maxSec: 60 } : {}) }))} />
                          <Choice legend={tr("cf.count")} values={[3, 5, 8]} value={opts.count} fmt={String} onChange={(count) => setOpts((o) => ({ ...o, count }))} />
                          <Choice legend={tr("cf.maxLen")} values={[30, 45, 60]} value={opts.maxSec} fmt={(v) => `${v} s`} onChange={(maxSec) => setOpts((o) => ({ ...o, maxSec }))} />
                          <label className="flex items-center gap-1.5">
                            <input type="checkbox" checked={opts.captions && data.tools.transcriber} onChange={(e) => setOpts((o) => ({ ...o, captions: e.target.checked }))} disabled={!data.tools.transcriber} />
                            {tr("cf.captions")}{!data.tools.transcriber ? tr("cf.needsTranscriber") : ""}
                          </label>
                          <EditOptions opts={opts} setOpts={setOpts} />
                          <button type="submit" className="btn" disabled={busy[k] || !data.tools.ffmpeg}>{busy[k] ? tr("cf.starting") : tr("life.start")}</button>
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
          <DevlogCard onChange={() => void load(true)} />
          </div>

          <div id="cf-panel-clips" role="tabpanel" aria-labelledby="cf-tab-clips" hidden={shown !== "clips"} className="space-y-3">
          <Section title={tr("cf.jobs")} right={<>
            {(fails.length > 0 || showFailed) && (
              <button className="chip" aria-pressed={showFailed} onClick={() => setShowFailed((s) => !s)}>⚠ {tr("cf.failedN", { n: fails.length })}</button>
            )}
            <ScheduleAll count={unpublished} canUpload={!!yt?.canUpload} onChange={load} />
            {rejectedCount > 0 && (
              <button className="chip" aria-pressed={showRejected} onClick={() => setShowRejected((s) => !s)} aria-label={tr(showRejected ? "cf.hideRejected" : "cf.showRejected", { n: rejectedCount })}>
                {tr(showRejected ? "cf.hideRejected" : "cf.showRejected", { n: rejectedCount })}
              </button>
            )}
          </>}>
            {showFailed ? (!fails.length ? <Empty text={tr("cf.noFailed")} /> : (
              <ul className="space-y-2" aria-label={tr("cf.failedList")}>
                {fails.map((g) => (
                  <li key={g.source} className="rounded-xl border border-white/10 p-2 text-xs">
                    <b className="block truncate text-sm" title={g.source}>{g.job?.source ?? g.download?.file ?? g.download?.url ?? g.source}{g.count > 1 ? ` ×${g.count}` : ""}</b>
                    <span className="muted num text-[11px]">{when(g.at)}</span>
                    <p className="error">{g.error || tr("cf.dlFailed")}</p>
                    <div className="mt-1 flex gap-1.5">
                      {g.job ? <button className="btn" disabled={busy[`make:${g.job.source}`] || !data.tools.ffmpeg} onClick={() => { const j = byId.get(g.job!.id); if (j) void make(j.source, j.options, true); }}>{tr("task.retry")}</button>
                        : g.download && <button className="btn" disabled={busy[`dl:${g.download.id}`] || !data.tools.ytdlp} onClick={() => { const d = g.download as Download; void download({ url: d.url, permission: d.permission, ...(d.autoClip ? { autoClip: d.autoClip } : {}) }, d.id); }}>{tr("task.retry")}</button>}
                      <button className="chip" onClick={() => dismiss(g.keys)}>{tr("cf.dismissFail")}</button>
                    </div>
                  </li>
                ))}
              </ul>
            )) : <>
            {!jobs.length && <Empty text={tr("cf.noClips")} action={<button className="btn" onClick={() => selectTab("find")}>🔭 {tr("cf.findVideos")}</button>} />}
            <div className="space-y-3">
              {jobs.map((j) => (
                <JobCard key={j.id} job={j} reduced={reduced} showRejected={showRejected} busy={busy} Note={Note} yt={yt} publishing={data.publishing}
                  onRetry={() => make(j.source, j.options, true)} onDelete={() => del(j.id)}
                  onPatch={(clip, body) => patchClip(j.id, clip, body)} onPublish={(clip, body) => publish(j.id, clip, body)}
                  onCheck={(clip) => checkYouTube(j.id, clip)} onVersion={(clip, body) => version(j.id, clip, body)} onTitles={(clip, review) => moreTitles(j.id, clip, review)} onReload={() => void load(true)} />
              ))}
            </div>
            </>}
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
function ScoutSection({ visible, onQueued, runSignal, reduced, layout }: { visible: boolean; onQueued: () => void; runSignal: number; reduced: boolean; layout?: ReactNode /* Clip it + creator auto-clip use the inbox auto-clip settings */ }) {
  const { t: tr } = useT();
  const [d, setD] = useState<ScoutData | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api<ScoutData>(SCOUT).then((x) => { setD(x); setErr(""); }, (e) => setErr(e instanceof Error ? e.message : "Couldn't load the scout")), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!d?.running || !visible) return;
    const t = setInterval(() => { if (!document.hidden) void load(); }, 3000);
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
    <Section title={tr("cf.scout")} right={d && (
      <div className="flex items-center gap-1.5">
        <button className="chip" aria-expanded={open} aria-controls="scout-settings" onClick={() => setOpen((o) => !o)} aria-label={tr("cf.scoutSettings")}>⚙ {tr("cf.settings")}</button>
        <button className="btn !px-3 !py-1 !text-xs" onClick={() => void run()} disabled={busy.run || d.running || !d.configured} aria-label={tr("cf.runScoutAria")}>{d.running ? tr(d.researching ? "cf.researching" : "cf.scouting") : busy.run ? tr("cf.starting") : `🔭 ${tr("cf.runScoutNow")}`}</button>
      </div>
    )}>
      {err && <p className="error text-xs" role="alert">{err}</p>}
      {!d && !err && <div className="space-y-2" role="status" aria-label={tr("cf.loadingScout")}><span className="sr-only">{tr("cf.loadingScout")}…</span><Skeleton h={18} reduced={reduced} /><Skeleton h={90} reduced={reduced} /></div>}
      {d && !d.configured && <p className="text-xs">{tr("cf.apiKey1")} <code className="num rounded bg-black/40 px-1">{"YOUTUBE_API_KEY"}</code> {tr("cf.apiKey2")}</p>}
      {d && s && (
        <>
          <div className="flex flex-wrap items-center gap-x-1">
          <p className="muted num text-[11px]" aria-live="polite">
            {last ? `Last run ${ago(last.at)} · ${last.candidates} videos checked${last.auto ? ` · ${last.auto} auto-clipped` : ""}` : "Never run yet"}
          </p>
            <Help text={`${last ? `Last run ${when(last.at)}, ranked by ${last.ranker === "claude" ? "Claude" : "stats"}. ` : ""}YouTube budget today ${d.usedToday}/${d.budget} units. Runs daily at ${String(s.runAt).padStart(2, "0")}:00.`} />
          </div>
          {last && !last.ok && <p className="error mt-1 text-xs" role="alert">⚠ {last.error}</p>}
          {!!last?.warnings?.length && <ul className="mt-1 space-y-0.5 text-[11px]" aria-label={tr("cf.scoutWarnings")}>{last.warnings.slice(0, 5).map((w, k) => <li key={k}>⚠ {w}</li>)}</ul>}
          <Note k="run" />
          {layout}
          <CreatorsBox s={s} busy={busy} Note={Note} added={added} onSave={save} onAdd={addCreator} />
          <NicheCard d={d} busy={busy} Note={Note} onSave={save} onAdd={addCreator}
            onResearch={() => act("niche", async () => { await api(`${SCOUT}/niche`, { method: "POST", body: {} }); setD((x) => x && { ...x, running: true, researching: true }); })}
            onUse={(name) => act("niche", async () => { setD(await api<ScoutData>(`${SCOUT}/niche`, { method: "POST", body: { use: name } })); })} />
          {open && <ScoutSettingsForm s={s} busy={busy} Note={Note} onSave={save} />}
          {last?.ok && last.summary && <p className="num mt-2 text-[11px]" role="status">{last.summary}</p>}
          {!picks.length ? (
            s.watchlist.length || s.keywords.length || s.aiKeywords.length
              ? <Empty text={tr(last ? "cf.noPicksTune" : "cf.noPicksRun")}
                  action={<button className="chip" onClick={() => void run()} disabled={busy.run || d.running || !d.configured}>🔭 {tr("cf.runScout")}</button>} />
              : <Empty text={tr("cf.addCreatorFirst")} />
          ) : (
            <ul className="mt-2 space-y-2" aria-label={tr("cf.scoutPicks")}>
              {picks.map((p) => (
                <li key={p.videoId} className="flex gap-2 rounded-xl border border-white/10 p-2 text-xs">
                  <a href={`https://www.youtube.com/watch?v=${p.videoId}`} target="_blank" rel="noopener noreferrer" className="shrink-0" aria-label={`Open ${p.title} on YouTube`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`https://i.ytimg.com/vi/${p.videoId}/mqdefault.jpg`} alt="" loading="lazy" className="h-[4.5rem] w-32 rounded-lg object-cover" />
                  </a>
                  <div className="min-w-0 flex-1">
                    <b className="line-clamp-2 leading-snug">{p.title}</b>
                    <span className="muted num block text-[11px]">{p.channel} · {mmss(p.durationSec)} · {ago(p.publishedAt)} · {tr("cf.views", { n: compact(p.stats.views) })}</span>
                    <p className="mt-0.5 leading-snug">{p.reason}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Status text={tr("cf.score", { n: p.score })} tone={p.score >= 70 ? "good" : undefined} />
                      <Status text={p.source === "watchlist" ? `★ ${tr("cf.watchlist")}` : `🔎 ${tr("cf.keyword")}`} />
                      {p.status === "queued" ? <Status text={tr("cf.sent")} tone="good" /> : (
                        <>
                          <button className="chip" onClick={() => void pick(p, "clip")} disabled={busy[`pick:${p.videoId}`]} aria-label={tr("cf.clipAria", { title: p.title })}>✂ {tr("cf.clipIt")}</button>
                          <button className="chip" onClick={() => void pick(p, "dismiss")} disabled={busy[`pick:${p.videoId}`]} aria-label={tr("cf.dismissAria", { title: p.title })}>{tr("cf.dismiss")}</button>
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
          {picks.some((p) => p.source === "keyword") && <p className="muted mt-2 text-[11px]">🔎 {tr("cf.kwFinds")} <Help text={tr("cf.kwFindsHelp")} /></p>}
        </>
      )}
    </Section>
  );
}

/** Creators the owner approved for clipping: always visible at the top of the scout (the main way to feed it). */
function CreatorsBox({ s, busy, Note, added, onSave, onAdd }: { s: ScoutSettings; busy: Record<string, boolean>; Note: (p: { k: string }) => ReactNode; added: string;
  onSave: (key: string, body: ScoutPatch) => Promise<boolean>; onAdd: (input: string) => Promise<boolean> }) {
  const [input, setInput] = useState("");
  const { t: tr } = useT();
  const setWatch = (creator: CreatorOp) => void onSave("watch", { creator });
  return (
    <div className="mt-2 rounded-xl border border-white/10 p-2 text-xs">
      <b className="block text-sm">★ {tr("cf.creators")}</b>
      <p className="muted text-[11px]">{tr("cf.creatorsOnly")} <Help text={tr("cf.creatorsHelp")} /></p>
      <ul className="mt-1 space-y-1" aria-label={tr("cf.watchlist")}>
        {s.watchlist.map((w) => (
          <li key={w.channelId} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate" title={w.channelId}>{w.title}</span>
            <label className="flex items-center gap-1"><input type="checkbox" checked={w.autoClip} disabled={busy.watch}
              onChange={(e) => setWatch({ channelId: w.channelId, autoClip: e.target.checked })} aria-label={tr("cf.autoClipAria", { title: w.title })} /> {tr("cf.autoClip")}</label>
            <ConfirmButton label={tr("common.remove")} aria={tr("cf.unwatchAria", { title: w.title })} disabled={busy.watch} onConfirm={() => setWatch({ channelId: w.channelId, remove: true })} />
          </li>
        ))}
      </ul>
      <Note k="watch" />
      <form className="mt-1 flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (input.trim() && (await onAdd(input.trim()))) setInput(""); }}>
        <input className="field min-w-0 flex-1 !px-2 !py-1 !text-xs" placeholder={tr("cf.creatorPh")} value={input} maxLength={200} onChange={(e) => setInput(e.target.value)} aria-label={tr("cf.creatorToAdd")} />
        <button type="submit" className="chip" disabled={busy.add || !input.trim()} aria-label={tr("cf.addCreator")}>{busy.add ? tr("cf.adding") : `+ ${tr("common.add")}`}</button>
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
  const { t: tr } = useT();
  const inUse = (kw: string[]) => kw.length === s.aiKeywords.length && kw.every((k) => s.aiKeywords.includes(k));
  return (
    <div className="mt-2 rounded-xl border border-white/10 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <b className="flex-1 text-sm">🧭 {tr("cf.nicheReport")}</b>
        <button className="chip" onClick={onResearch} disabled={busy.niche || d.running || !d.configured} aria-label={tr("cf.researchAria")}>{d.researching ? tr("cf.researching") : `🔭 ${tr("cf.findNiche")}`}</button>
      </div>
      <div className="flex flex-wrap items-center gap-x-1">
      <p className="muted num text-[11px]" aria-live="polite">
        {rep ? tr("cf.report", { at: when(rep.at) }) + (s.nicheAuto ? tr("cf.reportAuto") : "") : tr("cf.nicheHint")}
        {run && tr("cf.lastResearch", { at: when(run.at), units: run.units })}
      </p>
        {!rep && <Help text={tr("cf.nicheHelp")} />}
      </div>
      {run && !run.ok && <p className="error mt-1 text-xs" role="alert">⚠ {run.error}</p>}
      {!!run?.warnings?.length && <ul className="mt-1 space-y-0.5 text-[11px]" aria-label={tr("cf.nicheNotes")}>{run.warnings.slice(0, 4).map((w, k) => <li key={k}>{w.startsWith("Auto:") ? "✓" : "⚠"} {w}</li>)}</ul>}
      <Note k="niche" />
      {rep && (
        <ol className="mt-1 space-y-2" aria-label={tr("cf.niches")}>
          {rep.niches.map((n) => (
            <li key={n.name} className="rounded-lg border border-white/10 p-2">
              <div className="flex flex-wrap items-center gap-1">
                <b className="flex-1">{n.name}</b>
                <Status text={tr("cf.score", { n: n.score })} tone={n.score >= 70 ? "good" : undefined} />
                {inUse(n.keywords) ? <Status text={tr("cf.kwInUse")} tone="good" /> : <button className="chip" onClick={() => onUse(n.name)} disabled={busy.niche} aria-label={tr("cf.useNicheAria", { name: n.name })}>{tr("cf.useNiche")}</button>}
              </div>
              <p className="mt-0.5 leading-snug">{n.why}</p>
              <p className="muted text-[11px]">{tr("cf.keywords")} {n.keywords.join(" · ")}</p>
              <ul className="mt-1 space-y-0.5" aria-label={tr("cf.creatorsFor", { name: n.name })}>
                {rep.creators.filter((c) => c.niche === n.name).map((c) => (
                  <li key={c.channelId} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1"><b>{c.title}</b> <span className="muted num">{tr("cf.subs", { n: compact(c.subscribers) })}</span> — {c.evidence}</span>
                    {watching.has(c.channelId) ? <Status text={`★ ${tr("cf.watching")}`} /> : <button className="chip" onClick={() => void onAdd(c.channelId)} disabled={busy.add} aria-label={tr("cf.watchAria", { title: c.title })}>＋ {tr("cf.watch")}</button>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {!!s.aiKeywords.length && (
        <p className="mt-1 text-[11px]">{tr("cf.aiKw")} {s.aiKeywords.join(" · ")}{" "}
          <button className="chip" onClick={() => void onSave("aikw", { aiKeywords: [] })} disabled={busy.aikw} aria-label={tr("cf.clearAiKw")}>{tr("cf.clear")}</button></p>
      )}
      <Note k="aikw" />
    </div>
  );
}

function ScoutSettingsForm({ s, busy, Note, onSave }: { s: ScoutSettings; busy: Record<string, boolean>; Note: (p: { k: string }) => ReactNode;
  onSave: (key: string, body: ScoutPatch) => Promise<boolean> }) {
  const { t: tr } = useT();
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
        <label className="block"><span className={label}>{tr("cf.kwHelp")}</span>
          <textarea className="field w-full !px-2 !py-1 !text-xs" rows={3} value={f.keywords} onChange={(e) => setF((x) => ({ ...x, keywords: e.target.value }))} />
        </label>
        <div className="flex flex-wrap gap-2">
          {numField("creatorMaxAgeDays", tr("cf.creatorAge"), 1, 60)}{numField("maxAgeHours", tr("cf.kwAge"), 1, 336)}{numField("minMinutes", tr("cf.minLen"), 1, 180)}
          {numField("dailyAuto", tr("cf.autoPerDay"), 0, 5)}{numField("runAt", tr("cf.runHour"), 0, 23)}
        </div>
        <button type="submit" className="btn" disabled={busy.settings}>{tr(busy.settings ? "auto.saving" : "cf.saveSettings")}</button>
        <Note k="settings" />
      </form>
      <div>
        <label className="flex items-center gap-1"><input type="checkbox" checked={s.nicheAuto} disabled={busy.nicheAuto}
          onChange={(e) => void onSave("nicheAuto", { nicheAuto: e.target.checked })} /> {tr("cf.nicheAuto")}</label>
        <p className="muted text-[11px]">{tr("cf.autoChoice")} <Help text={tr("cf.strikes")} /></p>
        <Note k="nicheAuto" />
      </div>
    </div>
  );
}

function ToolsBanner({ tools }: { tools: ToolsStatus }) {
  const { t: tr } = useT();
  const [copied, setCopied] = useState(false);
  const onlyTranscriber = tools.ffmpeg && !tools.transcriber;
  return (
    <div className="card text-sm" role="status" style={{ borderColor: "#fb923c" }}>
      <b>⚠ {tr(onlyTranscriber ? "cf.noCaptions" : "cf.noTools")}</b>
      <p className="mt-1">{tr("cf.missing")} {tools.missing.join(", ")}.</p>
      {onlyTranscriber && <p className="mt-1">{tr("cf.stillWork")}</p>}
      <p className="mt-1">{tr("cf.runPs")}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="num block min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-black/40 p-2 text-xs">{SETUP}</code>
        <button className="chip shrink-0" aria-label={tr("cf.copySetup")} onClick={() => navigator.clipboard?.writeText(SETUP).then(() => setCopied(true), () => setCopied(false))}>
          {copied ? `${tr("cf.copied")} ✓` : tr("common.copy")}
        </button>
      </div>
    </div>
  );
}

function QuarantineNotice({ root, files }: { root: string; files: Quarantined[] }) {
  const { t: tr } = useT();
  const sep = root.includes("\\") ? "\\" : "/";
  const dirs = [...new Set(files.map((q) => q.file.split("/").slice(0, -1).join(sep)))];
  const n = files.length, kind = files.every((q) => /^(jobs|downloads)\//.test(q.file)) ? "job" : "data"; // root files: scout.json, learn.json…
  return (
    <div className="card text-sm" role="alert" style={{ borderColor: "#fb923c" }}>
      <b>⚠ {n === 1 ? `1 damaged ${kind} file was set aside` : `${n} damaged ${kind} files were set aside`}:</b>
      <ul className="mt-1 text-xs">{files.slice(0, 5).map((q) => <li key={q.file}><span className="num">{q.file.split("/").pop()}</span> — {q.reason}{q.at ? ` · ${when(q.at)}` : ""}</li>)}</ul>
      {n > 5 && <p className="muted text-xs">{tr("cf.andMore", { n: n - 5 })}</p>}
      <p className="mt-1 text-xs">{tr("cf.movedIn")}</p>
      {dirs.map((d) => <code key={d} className="num mt-1 block overflow-x-auto whitespace-nowrap rounded bg-black/40 p-2 text-xs">{root}{sep}{d}</code>)}
      <p className="muted mt-1 text-xs">{tr("cf.moveToClear")}</p>
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
  const { t: tr } = useT();
  const okUrl = parseClipUrl(url.trim()), ch = okUrl ? channelLink(okUrl) : null; // a channel page: wrong box
  const submit = async () => {
    if (!okUrl || ch) return;
    if (await onSubmit({ url: okUrl, permission: "", ...(auto ? { autoClip: { ...opts, preset: "viral", captions: opts.captions && tools.transcriber } } : {}) })) setUrl("");
  };
  return (
    <form className="mt-3 space-y-2 rounded-xl border border-white/10 p-2 text-xs" aria-label={tr("cf.addLink")} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <b className="block text-sm">🔗 {tr("cf.addLink")}</b>
      <label className="block">
        <span className="muted mb-1 block text-[10px] uppercase tracking-widest">{tr("cf.linkLabel")}</span>
        <input className="field w-full !px-2 !py-1 !text-xs" type="text" inputMode="url" maxLength={2000} placeholder={tr("cf.linkPh")} value={url}
          onChange={(e) => setUrl(e.target.value)} aria-invalid={!!url.trim() && !okUrl} />
      </label>
      {!!url.trim() && !okUrl && <p className="error">{tr("cf.badLink")}</p>}
      {ch && <p className="error" role="alert">{CHANNEL_LINK_MSG[ch]}</p>}
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> {tr("cf.makeWhenDl")}
      </label>
      {auto && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <Choice legend={tr("cf.count")} values={[3, 5, 8]} value={opts.count} fmt={String} onChange={(count) => setOpts((o) => ({ ...o, count }))} />
          <Choice legend={tr("cf.maxLen")} values={[30, 45, 60]} value={opts.maxSec} fmt={(v) => `${v} s`} onChange={(maxSec) => setOpts((o) => ({ ...o, maxSec }))} />
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={opts.captions && tools.transcriber} onChange={(e) => setOpts((o) => ({ ...o, captions: e.target.checked }))} disabled={!tools.transcriber} />
            {tr("cf.captions")}{!tools.transcriber ? tr("cf.needsTranscriber") : ""}
          </label>
          <EditOptions opts={opts} setOpts={setOpts} />
        </div>
      )}
      <button type="submit" className="btn" disabled={busy || !okUrl || !!ch || !tools.ytdlp || !tools.ffmpeg}>{busy ? tr("cf.adding") : `⬇ ${tr("cf.download")}`}</button>
      {!tools.ytdlp && <p>{tr("cf.ytdlp1")} <code className="num rounded bg-black/40 px-1">{YTDLP_SETUP}</code> {tr("cf.ytdlp2")}</p>}
    </form>
  );
}

function Conflict({ onAgain, busy }: { onAgain: () => void; busy?: boolean }) {
  const { t: tr } = useT();
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs" role="alert">
      {tr("cf.hasClips")} <button className="chip" onClick={onAgain} disabled={busy}>{tr(busy ? "cf.starting" : "cf.makeAgain")}</button>
    </p>
  );
}

function Choice<T extends string | number>({ legend, values, value, fmt, onChange, hint }: { legend: string; values: T[]; value: T; fmt: (v: T) => string; onChange: (v: T) => void; hint?: string }) {
  return (
    <fieldset>
      <legend className="muted mb-1 text-[10px] uppercase tracking-widest">{legend}</legend>
      <div className="flex flex-wrap gap-1">
        {values.map((v) => <button key={v} type="button" className="chip num" aria-pressed={value === v} onClick={() => onChange(v)}>{fmt(v)}</button>)}
      </div>
      {hint && <p className="muted mt-1 text-[10px]">{hint}</p>}
    </fieldset>
  );
}

/** Devlog folder: OBS recordings saved into <inbox>/devlog become 3 devlog Shorts each, waiting in review (never published on their own). */
type DevlogState = { enabled: boolean; days: Record<string, number>; path: string; problem?: string; options?: Opts }; // GET/POST /api/studio/clips/devlog
function DevlogCard({ onChange }: { onChange: () => void }) {
  const { t: tr } = useT();
  const [s, setS] = useState<DevlogState | null>(null);
  const [busy, setBusy] = useState(""), [note, setNote] = useState(""), [err, setErr] = useState("");
  useEffect(() => { void api<DevlogState>(`${API}/devlog`).then(setS, (e) => setErr(e instanceof Error ? e.message : "Couldn't load")); }, []);
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); setErr(""); setNote(""); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(""); } };
  const toggle = (enabled: boolean) => run("auto", async () => { setS(await api<DevlogState>(`${API}/devlog`, { method: "POST", body: { enabled } })); onChange(); });
  const setLayout = (p: Partial<LayoutOpts>) => s && run("layout", async () => { setS(await api<DevlogState>(`${API}/devlog`, { method: "POST", body: { enabled: s.enabled, ...p } })); });
  const open = () => run("open", async () => {
    try { await api(`${API}/open`, { method: "POST", body: { folder: "devlog" } }); setNote("Opened in Explorer."); }
    catch (e) { throw e instanceof HttpError && e.status === 501 ? new Error("Opening the folder only works on the Windows PC. Use the path above.") : e; }
  });
  const day = s ? Math.max(0, ...Object.values<number>(s.days)) : 0;
  return (
    <Section title={tr("cf.devlogTitle")}>
      <p className="text-sm">{tr("cf.devlogIntro")}</p>
      {s && <code className="num mt-1 block overflow-x-auto whitespace-nowrap rounded bg-black/40 p-2 text-xs">{s.path}</code>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="chip" onClick={open} disabled={!!busy}>{busy === "open" ? tr("cf.opening") : `📂 ${tr("cf.openDevlog")}`}</button>
        {note && <span className="ok text-xs" role="status">{note}</span>}
        {s && <span className="muted num text-[11px]">{day ? tr("cf.lastDevlog", { n: day }) : tr("cf.noDevlog")}</span>}
      </div>
      <label className="mt-2 flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={!!s?.enabled} disabled={!s || !!busy} onChange={(e) => void toggle(e.target.checked)} />
        {tr("cf.devlogAuto")} <Help text={tr("cf.devlogAutoHelp")} />
      </label>
      {s?.options && <LayoutChip o={s.options} onSave={(p) => void setLayout(p)} />}
      {s?.problem && <p className="error mt-1 text-xs" role="alert">{s.problem}</p>}
      {err && <p className="error mt-1 text-xs" role="alert">{err}</p>}
      <DevlogScriptBox />
    </Section>
  );
}

/** "Suggest a devlog script from my commits this week": one Claude call over git log/diffstat (read-only), shown for copy. Never published. */
type GitRepos = { env: string[]; saved: string[] };
type Script = { hook: string; script: string; titles: string[] };
function DevlogScriptBox() {
  const { t: tr } = useT();
  const [repos, setRepos] = useState<GitRepos | null>(null), [draft, setDraft] = useState(""), [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [out, setOut] = useState<(Script & { commits: number }) | null>(null), [copied, setCopied] = useState(false);
  useEffect(() => { void api<GitRepos>("/api/git").then((r) => { setRepos(r); setDraft(r.saved.join("\n")); }, () => setRepos(null)); }, []);
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); setErr(""); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(""); } };
  const save = () => run("save", async () => { const r = await api<GitRepos>("/api/git", { method: "POST", body: { repos: draft } }); setRepos(r); setDraft(r.saved.join("\n")); setEdit(false); });
  const suggest = () => run("suggest", async () => { setOut(null); setCopied(false); const r = await api<{ script: Script; commits: number }>("/api/git", { method: "POST", body: { action: "devlog" } }); setOut({ ...r.script, commits: r.commits }); });
  const all = [...(repos?.env ?? []), ...(repos?.saved ?? [])];
  const text = out ? `Hook: ${out.hook}\n\n${out.script}\n\nTitles:\n${out.titles.map((t) => `- ${t}`).join("\n")}` : "";
  return (
    <div className="mt-3 space-y-2 border-t border-white/10 pt-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button className="chip" onClick={() => void suggest()} disabled={!!busy || !all.length}>{busy === "suggest" ? tr("cf.writing") : `✍ ${tr("cf.suggestScript")}`}</button>
        <button className="chip text-xs" onClick={() => setEdit((v) => !v)} aria-expanded={edit}>{tr("cf.gitRepos", { n: all.length })}</button>
      </div>
      {(edit || (repos && !all.length)) && (
        <div className="space-y-1">
          {repos?.env.map((p) => <code key={p} className="num block text-xs">{p} <span className="muted">{"(ORBIT_GIT_REPOS)"}</span></code>)}
          <textarea className="field num w-full text-xs" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tr("cf.repoPh")} aria-label={tr("cf.repoAria")} />
          <button className="chip text-xs" onClick={() => void save()} disabled={!!busy}>{tr(busy === "save" ? "auto.saving" : "cf.saveRepos")}</button>
          <span className="muted ml-2 text-[11px]">{tr("cf.repoHint")}</span>
        </div>
      )}
      {err && <p className="error text-xs" role="alert">{err}</p>}
      {out && (
        <div className="space-y-1 rounded bg-black/30 p-2">
          <p className="muted text-[11px]">{tr("cf.fromCommits", { n: out.commits })}</p>
          {out.hook && <p><b>{tr("cf.hook")}</b> {out.hook}</p>}
          <p className="whitespace-pre-wrap">{out.script}</p>
          {out.titles.length > 0 && <ul className="muted list-disc pl-4 text-xs">{out.titles.map((t) => <li key={t}>{t}</li>)}</ul>}
          <button className="chip text-xs" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false))}>{tr(copied ? "cf.copied" : "common.copy")}</button>
        </div>
      )}
    </div>
  );
}

const LAYOUT: Record<Opts["layout"], [string, string]> = {
  fit: [LAYOUT_NAME.fit, "Whole frame over a blurred background"],
  fill: [LAYOUT_NAME.fill, "Crops the middle to full screen (facecam-centred streams)"],
  split: [LAYOUT_NAME.split, "Facecam and gameplay stacked"],
  follow: [LAYOUT_NAME.follow, "A 9:16 crop that pans to the person / action (cuts jump)"],
};
const LAYOUTS: Opts["layout"][] = ["fit", "fill", "follow", "split"];
const CAM_SIDES: CamSide[] = ["left", "right", "tl", "tr", "bl", "br"];
const CAM_LABEL: Record<CamSide, string> = CAM_NAME;
const CAM_SIZES = [0.22, 0.3, 0.4], CAM_SIZE_LABEL = ["Small", "Medium", "Large"];
/** Facecam position (+ box size for a corner cam: shown on top, the frame's middle below) for the split layout. */
function CamPicker({ side, size, set }: { side: CamSide; size?: number; set: (p: { camSide?: CamSide; camSize?: number }) => void }) {
  return (
    <>
      <Choice legend="Facecam" values={CAM_SIDES} value={side} fmt={(v) => CAM_LABEL[v]} onChange={(camSide) => set({ camSide })}
        hint={side.length === 2 ? "Cam box on top, gameplay below" : "Gameplay on top, cam third below"} />
      {side.length === 2 && <Choice legend="Cam box width" values={CAM_SIZES} value={CAM_SIZES.includes(size ?? 0.3) ? (size ?? 0.3) : 0.3}
        fmt={(v) => CAM_SIZE_LABEL[CAM_SIZES.indexOf(v)]} onChange={(camSize) => set({ camSize })} />}
    </>
  );
}

/** Layout, pacing, zooms and language for a clip job. */
function EditOptions({ opts, setOpts }: { opts: Opts; setOpts: (f: (o: Opts) => Opts) => void }) {
  const { t: tr } = useT();
  return (
    <>
      <Choice legend={tr("cf.layout")} values={LAYOUTS} value={opts.layout} fmt={(v) => LAYOUT[v][0]} hint={LAYOUT[opts.layout][1]}
        onChange={(layout) => setOpts((o) => ({ ...o, layout }))} />
      {opts.layout === "split" && <CamPicker side={opts.camSide} size={opts.camSize} set={(p) => setOpts((o) => ({ ...o, ...p }))} />}
      <Choice legend={tr("cf.speech")} values={["en", "auto"] as Opts["language"][]} value={opts.language} fmt={(v) => tr(v === "en" ? "cf.english" : "cf.anyLang")}
        onChange={(language) => setOpts((o) => ({ ...o, language }))} />
      <label className="flex items-center gap-1.5" title={tr("cf.jumpTitle")}>
        <input type="checkbox" checked={opts.jumpCuts} onChange={(e) => setOpts((o) => ({ ...o, jumpCuts: e.target.checked }))} /> {tr("cf.jumpLong")}
      </label>
      <label className="flex items-center gap-1.5" title={tr("cf.zoomTitle")}>
        <input type="checkbox" checked={opts.zooms} onChange={(e) => setOpts((o) => ({ ...o, zooms: e.target.checked }))} /> {tr("cf.zoomLong")}
      </label>
      <label className="flex items-center gap-1.5" title={tr("cf.coldTitle")}>
        <input type="checkbox" checked={opts.coldOpen} onChange={(e) => setOpts((o) => ({ ...o, coldOpen: e.target.checked }))} /> {tr("cf.coldLong")}
      </label>
      <label className="flex items-center gap-1.5" title={tr("cf.loopTitle")}>
        <input type="checkbox" checked={opts.loopEnd} onChange={(e) => setOpts((o) => ({ ...o, loopEnd: e.target.checked }))} /> {tr("cf.loopLong")}
      </label>
      <label className="flex items-center gap-1.5" title={tr("cf.barTitle")}>
        <input type="checkbox" checked={opts.progressBar} onChange={(e) => setOpts((o) => ({ ...o, progressBar: e.target.checked }))} /> {tr("cf.bar")}
      </label>
    </>
  );
}

type LayoutOpts = Pick<Opts, "layout" | "camSide" | "camSize">;
/** Clips started from saved settings (inbox auto-clip, devlog folder): the layout they get, changeable in place. */
function LayoutChip({ o, onSave }: { o: LayoutOpts; onSave: (p: Partial<LayoutOpts>) => void }) {
  const { t: tr } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 text-xs">
      <span className="muted">{tr("cf.layout")}: </span>
      <button type="button" className="chip !px-2 !py-0.5 !text-[11px]" aria-expanded={open} onClick={() => setOpen((x) => !x)}
        aria-label={`${tr("cf.layout")}: ${layoutText(o)}. ${tr(open ? "common.close" : "cf.changeCap")}`}>{layoutText(o)} · {tr(open ? "cf.done" : "cf.change")}</button>
      {open && (
        <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-2">
          <Choice legend={tr("cf.layout")} values={LAYOUTS} value={o.layout} fmt={(v) => LAYOUT[v][0]} hint={LAYOUT[o.layout][1]} onChange={(layout) => onSave({ layout })} />
          {o.layout === "split" && <CamPicker side={o.camSide} size={o.camSize} set={onSave} />}
        </div>
      )}
    </div>
  );
}

/* ---------- jobs & clips ---------- */

type PatchBody = { status?: "approved" | "rejected"; title?: string; reason?: string; thumb?: string; replaceOriginal?: string };
type PatchFn = (clip: string, body: PatchBody) => Promise<boolean>;
type PublishFn = (clip: string, body: PublishBody) => Promise<boolean>;
type VersionFn = (clip: string, body: VersionBody) => Promise<boolean>;

function JobCard({ job, reduced, showRejected, busy, Note, yt, publishing, onRetry, onDelete, onPatch, onPublish, onCheck, onVersion, onTitles, onReload }: {
  job: ClipJob; publishing?: string | null; reduced: boolean; showRejected: boolean; busy: Record<string, boolean>; Note: (p: { k: string }) => ReactNode; yt: YtStatus | null;
  onRetry: () => void; onDelete: () => void; onPatch: PatchFn; onPublish: PublishFn; onCheck: (clip: string) => Promise<boolean>; onVersion: VersionFn; onTitles: (clip: string, review?: boolean) => Promise<boolean>; onReload: () => void;
}) {
  const o = job.options; // what the original clips were rendered with (mirrors baseEdit in pure.ts)
  const { t: tr } = useT();
  const base: VersionEdit = { layout: o.layout ?? "fit", camSide: o.camSide ?? "right", camSize: o.camSize, captions: o.captions ? "karaoke" : "none", jumpCuts: o.jumpCuts ?? true, zooms: o.zooms ?? true,
    coldOpen: o.coldOpen ?? false, progressBar: o.progressBar ?? false, loopEnd: o.loopEnd ?? false }; // missing = job from before these options
  const working = isJobActive(job), pct = Math.round(Math.min(1, Math.max(0, job.progress || 0)) * 100);
  const clips = job.clips.filter((c) => showRejected || c.status !== "rejected");
  const hidden = job.clips.length - clips.length;
  return (
    <article className="rounded-xl border border-white/10 p-2.5" aria-label={`Clip job: ${job.source}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <b className="block truncate text-sm" title={job.source}>{job.source}</b>
          <span className="muted num text-[11px]">
            {when(job.createdAt)}{job.durationSec ? tr("cf.long", { d: mmss(job.durationSec) }) : ""} · {tr("cf.clipsMax", { n: job.options.count, s: job.options.maxSec })}{job.options.captions ? tr("cf.withCaptions") : ""} · {layoutText(job.options)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {job.status === "failed" && isSkip(job.error) ? <Status text={`⤼ ${tr("cf.skipped")}`} /> : <Status text={JOB_LABEL[job.status] ?? job.status} tone={toneOf(job.status)} />}
          <ConfirmButton label={tr("rules.delete")} sure={tr("cf.deleteQ")} aria={tr("cf.deleteJob", { src: job.source })} onConfirm={onDelete} disabled={busy[`del:${job.id}`]} />
        </div>
      </div>
      <Note k={`del:${job.id}`} />

      {working && (
        <Progress pct={pct} step={job.step} label={`Progress for ${job.source}`} reduced={reduced} />
      )}

      {job.status === "done" && job.timings && (
        <p className="muted num mt-1 text-[11px]">
          {tr("cf.took", { total: mmss(job.timings.audio + job.timings.transcribe + job.timings.pick + job.timings.render), audio: mmss(job.timings.audio), transcribe: mmss(job.timings.transcribe), pick: mmss(job.timings.pick), render: mmss(job.timings.render) })}
        </p>
      )}

      {job.hype && (
        <HypeWave hype={job.hype} duration={job.durationSec ?? 0} reduced={reduced}
          clips={clips.filter((c) => !c.variantOf && c.status !== "failed").map((c) => ({ id: c.id, start: c.start, end: c.end, title: c.title, score: c.virality?.score }))}
          onPick={(id) => { const el = document.getElementById(`cf-clip-${job.id}/${id}`); el?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" }); el?.focus({ preventScroll: true }); }} />
      )}

      {job.warnings.length > 0 && <ul className="mt-2 space-y-0.5 text-xs" aria-label={tr("cf.warnings")}>{job.warnings.map((w, k) => <li key={k} className={w.startsWith("Looks like a re-upload") ? "error font-medium" : undefined}>⚠ {w}</li>)}</ul>}

      {job.status === "failed" && (
        <div className="mt-2 text-sm" role="alert">
          <p className="error">{job.error || tr("cf.jobFailed")}</p>
          <button className="btn mt-2" onClick={onRetry} disabled={busy[`make:${job.source}`]}>{tr(busy[`make:${job.source}`] ? "cf.starting" : "task.retry")}</button>
          <Note k={`make:${job.source}`} />
        </div>
      )}

      {clips.length > 0 && (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2" aria-label={`Clips from ${job.source}`}>
          {clips.map((c) => (
            <li key={c.id} id={`cf-clip-${job.id}/${c.id}`} tabIndex={-1} className="rounded-xl focus:outline focus:outline-2 focus:outline-[#f43f5e]">
              <ClipCard clip={c} reduced={reduced} busy={!!busy[`clip:${job.id}/${c.id}`]} onPatch={onPatch} note={<><Note k={`clip:${job.id}/${c.id}`} />{c.status === "ready" && <OrbitThinks id={`clip:${job.id}/${c.id}`} />}</>}
                picks={(c.status === "ready" || c.status === "approved") && <>
                  <ClipPicks clip={c} busy={!!busy[`clip:${job.id}/${c.id}`]} onPick={(body) => void onPatch(c.id, body)}
                    onMore={() => void onTitles(c.id)} onReview={() => void onTitles(c.id, true)} moreBusy={!!busy[`titles:${job.id}/${c.id}`]} />
                  <Note k={`titles:${job.id}/${c.id}`} />
                </>}
                version={(c.status === "ready" || c.status === "approved") && !working && <>
                  <VersionBox clip={c} base={{ ...base, ...c.edit }} busy={!!busy[`ver:${job.id}/${c.id}`]} onVersion={onVersion} note={<Note k={`ver:${job.id}/${c.id}`} />} />
                  {!c.hookLab && <HookLabBox jobId={job.id} clip={c} started={job.clips.some((x) => x.hookLab?.of === c.id)} onReload={onReload} />}
                </>}
                publish={c.status === "approved" && <PublishBox jobId={job.id} devlog={job.options.preset === "devlog"} clip={c} yt={yt} reduced={reduced} busy={!!busy[`pub:${job.id}/${c.id}`]} onPublish={onPublish} onVersion={onVersion}
                  stale={c.publish?.status === "uploading" && publishing !== `${job.id}/${c.id}`}
                  onCheck={() => onCheck(c.id)} note={<Note k={`pub:${job.id}/${c.id}`} />} />} />
            </li>
          ))}
        </ul>
      )}
      {!clips.length && job.status === "done" && <p className="muted mt-2 text-xs">{hidden ? tr("cf.allRejected", { n: hidden }) : tr("cf.noneFound")}</p>}
    </article>
  );
}

function ClipCard({ clip: c, reduced, busy, onPatch, note, picks, version, publish }: { clip: Clip; reduced: boolean; busy: boolean; onPatch: PatchFn; note: ReactNode; picks: ReactNode; version: ReactNode; publish: ReactNode }) {
  const [play, setPlay] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const { t: tr } = useT();
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
            <span className={c.status === "failed" ? "error" : "muted"}>{c.status === "failed" ? `⚠ ${c.error || tr("cf.renderFailed")}` : `🎞 ${tr("cf.rendering")}`}</span>
          </div>
        )}
        {c.virality && !play && <div className="pointer-events-none absolute right-1.5 top-1.5"><ScoreRing v={c.virality} reduced={reduced} /></div>}
      </div>

      <div className="flex flex-wrap gap-1">
        <Status text={CLIP_LABEL[c.status] ?? c.status} tone={toneOf(c.status)} />
        {c.variantOf && <Status text={`↳ v${c.id.match(/-v(\d+)$/)?.[1] ?? "?"} of ${rootClipId(c.id).replace("clip-", "clip ")}`} />}
        {c.hookLab && <Status text={`🧪 ${c.hookLab.label}`} />}
      </div>

      {edit != null ? (
        <form className="flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="sr-only" htmlFor={`t-${c.id}`}>{tr("cf.clipTitle")}</label>
          <input id={`t-${c.id}`} className="field !px-2 !py-1 !text-xs" value={edit} maxLength={120} autoFocus
            onChange={(e) => setEdit(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setEdit(null); }} />
          <div className="flex gap-1">
            <button type="submit" className="chip" disabled={busy || !edit.trim()}>{tr(busy ? "auto.saving" : "habit.save")}</button>
            <button type="button" className="chip" onClick={() => setEdit(null)}>{tr("common.cancel")}</button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-1">
          <b className="min-w-0 flex-1 leading-snug">{c.title}</b>
          <button className="chip shrink-0 !px-1.5 !py-0" onClick={() => setEdit(c.title)} aria-label={tr("cf.editTitle", { title: c.title })}>✎</button>
        </div>
      )}
      {c.status === "ready" && picks /* while reviewing, title/thumb picks stay in view */}
      {c.hook && <p className="leading-snug">“{c.hook}”</p>}
      {c.retryOf && <p className="text-xs">{tr("cf.retryOf", { title: c.retryOf.title })}</p>}
      {c.notes?.map((n, i) => <p key={i} className="muted text-[11px]">{n}</p>)}
      {c.reason && <p className="muted line-clamp-2 text-[11px] leading-snug" title={c.reason}>{c.reason}</p>}
      <p className="muted num text-[11px]">{mmss(c.start)}–{mmss(c.end)} · {mmss(len)} · {tr(c.virality ? "cf.editor" : "cf.scoreWord")} {score(c.score)}/100</p>
      {c.virality && <ScoreWhy v={c.virality} />}
      {c.video && c.error && <p className="muted text-[11px] leading-snug">⚠ {c.error}</p>}

      <div className="mt-auto flex flex-wrap gap-1">
        {reviewable && (
          <>
            {c.status !== "rejected" && <button className="chip" onClick={() => onPatch(c.id, { status: "approved", ...(c.retryOf && { replaceOriginal: c.retryOf.videoId }) })} disabled={busy || c.status === "approved"} aria-pressed={c.status === "approved"} aria-label={`Approve ${c.title}${c.retryOf ? " and replace original after publication" : ""}`}>✓ {tr(c.retryOf ? "cf.approveReplace" : "common.approve")}</button>}
            {c.status !== "rejected" && <RejectButton title={c.title} onReject={(reason) => void onPatch(c.id, { status: "rejected", ...(reason ? { reason } : {}) })} disabled={busy || c.publish?.status === "uploading"} />}
          </>
        )}
      </div>
      {note}
      {publish}
      {(c.video || version || (c.status !== "ready" && picks)) && (
        <>
          <button className="chip self-start !px-2 !py-0.5 !text-[10px]" aria-expanded={more} aria-controls={`more-${c.id}`} onClick={() => setMore((m) => !m)}
            aria-label={`${more ? "Fewer" : "More"} options for ${c.title}`}>{more ? `${tr("cf.less")} ▴` : `${tr("cf.more")} ▾`}</button>
          {/* hidden, not unmounted: an open "Another version" form keeps what was typed */}
          <div id={`more-${c.id}`} hidden={!more} className="flex flex-col gap-1.5">
            {c.status !== "ready" && picks}
            {version}
            {c.video && <a className="chip self-start" href={media(c.video)} download aria-label={tr("cf.downloadAria", { title: c.title })}>⬇ {tr("cf.download")}</a>}
          </div>
        </>
      )}
    </div>
  );
}

/** Reject in two clicks; while armed, a reason chip rejects in one click with that reason (optional, stored as feedback). */
function RejectButton({ title, disabled, onReject }: { title: string; disabled?: boolean; onReject: (reason?: string) => void }) {
  const { t: tr } = useT();
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 8000); return () => clearTimeout(t); }, [armed]);
  if (!armed) return <button className="chip" disabled={disabled} onClick={() => setArmed(true)} aria-label={tr("cf.rejectAria", { title })}>✕ {tr("common.reject")}</button>;
  const go = (r?: string) => { setArmed(false); onReject(r); };
  return (
    <div role="group" aria-label={`Reject ${title}`} className="flex w-full flex-wrap items-center gap-1"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArmed(false); }}>
      <button className="chip" autoFocus style={{ borderColor: "#fb7185" }} onClick={() => go()} aria-label={tr("cf.confirmAria", { aria: tr("cf.rejectAria", { title }) })}>{tr("cf.sure")} ✕</button>
      <span className="muted text-[10px]">{tr("cf.orWhy")}</span>
      {REJECT_REASONS.map((r) => <button key={r} className="chip !px-1.5 !py-0 !text-[10px]" onClick={() => go(r)} aria-label={`Reject ${title}: ${r}`}>{r}</button>)}
    </div>
  );
}

const CAPTION_LABEL: Record<CaptionStyle, string> = { karaoke: "Karaoke", classic: "Classic", none: "None" };
const signed = (n: number) => `${n > 0 ? "+" : ""}${n} s`;

/** "🧪 Hook lab": three alternative openings rendered as versions, ranked from channel data. The owner picks; publishing stays his click. */
function HookLabBox({ jobId, clip: c, started, onReload }: { jobId: string; clip: Clip; started: boolean; onReload: () => void }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [rank, setRank] = useState<HookLabRank | null>(null);
  const { t: tr } = useT();
  const url = `${API}/${encodeURIComponent(jobId)}/${encodeURIComponent(c.id)}/hooklab`;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(""); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(false); } };
  return (
    <div className="flex flex-col gap-1">
      {started
        ? <button className="chip self-start" disabled={busy} onClick={() => void run(async () => setRank(await api<HookLabRank>(url)))}>🧪 {tr(busy ? "cf.ranking" : "cf.compare")}</button>
        : <button className="chip self-start" disabled={busy} onClick={() => void run(async () => { await api(url, { method: "POST" }); onReload(); })}
            aria-label={`Hook lab: three alternative openings of ${c.title}`}>{busy ? tr("cf.starting") : `🧪 ${tr("cf.hookLab")}`}</button>}
      {err && <p className="error text-xs" role="alert">{err}</p>}
      {rank && (
        <div className="rounded-md border border-white/10 p-1.5 text-[11px]" aria-live="polite">
          {rank.pending > 0 && <p className="muted">{tr("cf.stillRendering", { n: rank.pending, total: rank.total })}</p>}
          {rank.why && <p><b>{tr("cf.winner")}</b> {rank.why}</p>}
          <ol className="mt-1 space-y-1">
            {rank.ranked.map((r) => (
              <li key={r.id}>
                <b>{r.id === rank.winner ? "★ " : ""}{r.label}</b> · {Math.round(r.score * 100)}/100 · {r.pattern}{r.hook && <> · “{r.hook}”</>}
                <ul className="muted list-disc pl-4">{r.why.map((w) => <li key={w}>{w}</li>)}</ul>
              </li>
            ))}
          </ol>
          <p className="muted mt-1">{tr("cf.predictionOnly")}</p>
        </div>
      )}
    </div>
  );
}

type VersionForm = VersionEdit & { title: string; hook: string; start: number; end: number; suggest: boolean };
/** "Another version": same moment re-rendered with other settings, from the saved analysis (fast, no transcription). */
function VersionBox({ clip: c, base, busy, onVersion, note }: { clip: Clip; base: VersionEdit; busy: boolean; onVersion: VersionFn; note: ReactNode }) {
  const [f, setF] = useState<VersionForm | null>(null);
  const { t: tr } = useT();
  if (!f) return (
    <div>
      <button className="chip" onClick={() => setF({ ...base, title: c.title, hook: c.hook, start: 0, end: 0, suggest: false })} aria-label={tr("cf.anotherAria", { title: c.title })}>↻ {tr("cf.another")}</button>
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
      <Choice legend={tr("cf.layout")} values={LAYOUTS} value={f.layout} fmt={(v) => LAYOUT[v][0]} onChange={(layout) => set({ layout })} />
      {f.layout === "split" && <CamPicker side={f.camSide} size={f.camSize} set={set} />}
      <Choice legend={tr("cf.captions")} values={[...CAPTION_STYLES]} value={f.captions} fmt={(v) => CAPTION_LABEL[v]} onChange={(captions) => set({ captions })} />
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.jumpCuts} onChange={(e) => set({ jumpCuts: e.target.checked })} /> {tr("cf.jump")}</label>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.zooms} onChange={(e) => set({ zooms: e.target.checked })} /> {tr("cf.zooms")}</label>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!f.coldOpen} onChange={(e) => set({ coldOpen: e.target.checked })} /> {tr("cf.cold")}</label>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!f.loopEnd} onChange={(e) => set({ loopEnd: e.target.checked })} /> {tr("cf.loop")}</label>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!f.progressBar} onChange={(e) => set({ progressBar: e.target.checked })} /> {tr("cf.bar")}</label>
      <fieldset>
        <legend className={label}>{tr("cf.trim")}</legend>
        {nudgeRow("start", tr("cf.start"))}{nudgeRow("end", tr("cf.end"))}
        <p className="muted num mt-0.5 text-[10px]">{mmss(Math.max(0, c.start + f.start))}–{mmss(c.end + f.end)}</p>
      </fieldset>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.suggest} onChange={(e) => set({ suggest: e.target.checked })} /> ✨ {tr("cf.suggestNew")}</label>
      {!f.suggest && (
        <>
          <label><span className={label}>{tr("cf.titleLbl")}</span><input className="field w-full !px-2 !py-1 !text-xs" value={f.title} maxLength={70} onChange={(e) => set({ title: e.target.value })} /></label>
          <label><span className={label}>{tr("cf.hookLbl")}</span><input className="field w-full !px-2 !py-1 !text-xs" value={f.hook} maxLength={40} placeholder={tr("cf.noHook")} onChange={(e) => set({ hook: e.target.value })} /></label>
        </>
      )}
      <div className="flex gap-1">
        <button type="submit" className="chip" disabled={busy}>{busy ? tr("cf.starting") : `↻ ${tr("cf.render")}`}</button>
        <button type="button" className="chip" onClick={() => setF(null)}>{tr("common.cancel")}</button>
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

function PublishBox({ jobId, devlog, clip: c, yt, reduced, busy, stale, onPublish, onCheck, onVersion, note }: { jobId: string; devlog: boolean; clip: Clip; yt: YtStatus | null; reduced: boolean; busy: boolean; stale: boolean; onPublish: PublishFn; onCheck: () => void; onVersion?: VersionFn; note: ReactNode }) {
  const [form, setForm] = useState<PublishBody | null>(null);
  const [at, setAt] = useState("");
  const { t: tr } = useT();
  const [mode, setMode] = useState<PubWhen>("now");
  const [sched, setSched] = useState<Schedule | null>(null);
  const p = c.publish;
  const unsure = p?.status === "unknown" || stale; // the last upload may be on YouTube: only an explicit "Upload again anyway" re-uploads
  const open = () => { setAt(""); setMode("now"); void api<Schedule>(`${API}/schedule`).then(setSched, () => setSched(null)); setForm({ title: c.title.replace(/[<>]/g, "").slice(0, 100), description: `${c.hook.replace(/[<>]/g, "")}\n\n${devlog ? devlogHashtags() : "#shorts"}`.trim(), privacy: "private", original: c.original ?? "", aiContent: false }); };
  const submit = async () => {
    if (!form) return;
    const publishAt = mode === "next" ? "next" : mode === "pick" && at ? new Date(at).toISOString() : undefined;
    if (await onPublish(c.id, { ...form, original: devlog ? undefined : form.original, ...(publishAt ? { publishAt } : {}), ...(unsure ? { force: true } : {}) })) setForm(null);
  };
  const reconnect = (text: string) => <p className="rounded-md px-1.5 py-1 text-[11px]" style={PUB_BOX}>{text} <a className="underline" href="/api/studio/oauth/start">{tr("cf.connectYt")}</a></p>;

  if (p?.status === "uploading" && !stale) {
    return <Progress pct={Math.round(Math.min(1, Math.max(0, p.progress ?? 0)) * 100)} step="Uploading to YouTube" label={`Upload progress for ${c.title}`} reduced={reduced} />;
  }
  if (p?.status === "done" && p.videoId) {
    return (
      <div className="space-y-1 rounded-md px-1.5 py-1 text-[11px]" style={PUB_BOX} role="status">
        <p>✓ {tr("cf.onYt")}{p.privacy ? ` · ${p.privacy}` : ""}</p>
        <a className="block underline" href={`https://youtube.com/shorts/${p.videoId}`} {...ext}>{tr("cf.openYt")} ↗</a>
        <a className="block underline" href={`https://studio.youtube.com/video/${p.videoId}/edit`} {...ext}>{tr("cf.openStudio")} ↗</a>
        <p className="muted">{tr("cf.stuck")} <Help text={LOCKED_NOTE} /></p>
      </div>
    );
  }
  if (p?.status === "scheduled" && p.videoId) {
    const live = !!p.scheduledFor && Date.parse(p.scheduledFor) <= Date.now();
    return (
      <div className="space-y-1 rounded-md px-1.5 py-1 text-[11px]" style={PUB_BOX} role="status">
        <p>{live ? `✓ ${tr("cf.liveSince", { at: when(p.scheduledFor!) })}` : `🕒 ${tr("cf.goesLive", { at: p.scheduledFor ? when(p.scheduledFor) : tr("cf.atScheduled") })}`}</p>
        <a className="block underline" href={`https://youtube.com/shorts/${p.videoId}`} {...ext}>{tr("cf.openYt")} ↗</a>
        <a className="block underline" href={`https://studio.youtube.com/video/${p.videoId}/edit`} {...ext}>{tr(live ? "cf.openStudio" : "cf.reschedule")} ↗</a>
        {!live && <p className="muted">{tr("cf.changeTime")} <Help text={tr("cf.changeTimeHelp")} /></p>}
      </div>
    );
  }
  if (unsure && !form) { // no plain retry: it could duplicate the video
    return (
      <div className="space-y-1 rounded-md px-1.5 py-1 text-[11px]" style={PUB_BOX} role="status">
        <p>⏳ {(p?.status === "unknown" && p.error) || tr("cf.unknown")}</p>
        {!yt?.connected && reconnect(tr("cf.checkNeeds"))}
        <div className="flex flex-wrap gap-1">
          <button className="chip" onClick={onCheck} disabled={busy} aria-label={`Check YouTube for ${c.title}`}>{busy ? tr("cf.checking") : `🔍 ${tr("cf.checkYt")}`}</button>
          {yt?.canUpload && <ConfirmButton label={tr("cf.uploadAgain")} sure={tr("cf.dupSure")} aria={`Upload ${c.title} again even though it may already be on YouTube`} onConfirm={open} disabled={busy} />}
        </div>
        {note}
      </div>
    );
  }
  if (yt && !yt.configured) return <p className="muted text-xs">{tr("cf.noOauth")}</p>;
  if (!yt?.connected) return reconnect(tr("cf.notConnected"));
  if (!yt.canUpload) return reconnect(tr("cf.reconnect"));
  if (!form) {
    return (
      <div className="space-y-1">
        {p?.status === "failed" && <p className="error text-[11px]" role="alert">⚠ {p.error || tr("cf.uploadFailed")}</p>}
        <button className="chip" onClick={open} aria-label={`Publish ${c.title} to YouTube`}>{p?.status === "failed" ? `↻ ${tr("cf.publishAgain")}` : `▶ ${tr("cf.publish")}`}</button>
        {note}
      </div>
    );
  }
  const set = (patch: Partial<PublishBody>) => setForm((f) => f && { ...f, ...patch });
  const label = "muted mb-0.5 block text-[10px] uppercase tracking-widest";
  const tooSoon = mode === "pick" && !!at && new Date(at).getTime() < Date.now() + MIN_LEAD;
  return (
    <form className="flex flex-col gap-1.5 rounded-md border border-white/10 p-1.5" aria-label={`Publish ${c.title} to YouTube`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label><span className={label}>{tr("cf.titleLbl")}</span>
        <input className="field w-full !px-2 !py-1 !text-xs" value={form.title} maxLength={100} required readOnly title={tr("cf.titleLocked")} /* STU03: the approved revision's title; change it on the clip and approve again */ />
      </label>
      <label><span className={label}>{tr("cf.description")}</span>
        <textarea className="field w-full !px-2 !py-1 !text-xs" rows={3} value={form.description} maxLength={5000} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <DescribeButton job={jobId} clip={c.id} onText={(description) => set({ description })} />
      {!devlog && (
        <label><span className={label}>{tr("cf.whatAdded")}</span>
          <input className="field w-full !px-2 !py-1 !text-xs" value={form.original ?? ""} maxLength={200} required minLength={10}
            placeholder={tr("cf.whatAddedPh")} onChange={(e) => set({ original: e.target.value })} />
          <span className="muted text-[11px]">{tr("cf.ownLayer")}</span>
        </label>
      )}
      {!devlog && onVersion && (
        // Uses the existing "make another version" render: the note becomes the big opening text (first 6 words, both renderers).
        <button type="button" className="chip self-start" disabled={(form.original ?? "").trim().length < 10}
          onClick={() => void onVersion(c.id, { hook: (form.original ?? "").trim(), original: (form.original ?? "").trim(), start: 0, end: 0, suggest: false })}>
          🖊 {tr("cf.takeOnScreen")}</button>
      )}
      <label className="flex items-center gap-1.5 text-[11px]">
        <input type="checkbox" checked={!!form.aiContent} onChange={(e) => set({ aiContent: e.target.checked })} />
        {tr("cf.aiContent")}
      </label>
      <label><span className={label}>{tr("cf.visibility")}</span>
        <select className="field w-full !px-2 !py-1 !text-xs" value={mode === "now" ? form.privacy : "private"} disabled={mode !== "now"} onChange={(e) => set({ privacy: e.target.value as PublishBody["privacy"] })}>
          <option value="private">{tr("cf.private")}</option><option value="unlisted">{tr("cf.unlisted")}</option><option value="public">{tr("cf.public")}</option>
        </select>
      </label>
      <Choice legend={tr("rules.when")} values={["now", "next", "pick"] as PubWhen[]} value={mode} fmt={(v) => tr(`cf.when.${v}`)} onChange={setMode} />
      {mode === "next" && <p className="muted text-[11px]">{sched ? (sched.next[0] ? tr("cf.nextSlot", { at: when(sched.next[0]) }) : tr("cf.noSlot")) : tr("cf.findingSlot")}</p>}
      {mode === "pick" && (
        <label><span className="sr-only">{tr("cf.publishTime")}</span>
          <input className="field w-full !px-2 !py-1 !text-xs" type="datetime-local" value={at} min={localInput(new Date(Date.now() + MIN_LEAD))} required onChange={(e) => setAt(e.target.value)} />
        </label>
      )}
      {tooSoon && <p className="error text-[11px]">{tr("cf.tooSoon")}</p>}
      {mode !== "now" && <p className="muted text-[11px]">{tr("cf.uploadsPrivate")}</p>}
      {mode !== "now" && sched && <SlotSettings sched={sched} onSaved={setSched} />}
      {/[<>]/.test(form.title + form.description) && <p className="error text-[11px]">{tr("cf.noBrackets")}</p>}
      <p className="muted text-[11px]">{tr("cf.mayPrivate")} <Help text={LOCKED_NOTE} /></p>
      <div className="flex gap-1">
        <button type="submit" className="chip" disabled={busy || !form.title.trim() || /[<>]/.test(form.title + form.description) || (mode === "pick" && (!at || tooSoon))}>{busy ? tr("cf.starting") : mode === "now" ? `▶ ${tr("cf.upload")}` : `🕒 ${tr("cf.schedule")}`}</button>
        <button type="button" className="chip" onClick={() => setForm(null)}>{tr("common.cancel")}</button>
      </div>
      {note}
    </form>
  );
}

/** "Slots: 12:00, 17:00, 21:00 · edit" — the owner's publishing slots (in their time zone), edited inline inside the publish form. */
function SlotSettings({ sched, onSaved }: { sched: Schedule; onSaved: (s: Schedule) => void }) {
  const [edit, setEdit] = useState<{ slots: string; perDay: number; timezone: string } | null>(null);
  const { t: tr } = useT();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const s = sched.settings, local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!edit) return (
    <p className="muted text-[11px]">
      {tr("cf.slots")} {s.slots.join(", ")}{s.perDay < s.slots.length ? tr("cf.maxPerDay", { n: s.perDay }) : ""}{s.timezone !== local ? ` (${s.timezone})` : ""} ·{" "}
      <button type="button" className="underline" onClick={() => setEdit({ slots: s.slots.join(", "), perDay: s.perDay, timezone: s.timezone })} aria-label={tr("cf.editSlots")}>{tr("cf.change")}</button>
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
      <legend className={label}>{tr("cf.pubSlots")}</legend>
      <label><span className={label}>{tr("cf.times")}</span><input className={field} value={edit.slots} onKeyDown={enter} onChange={(e) => setEdit({ ...edit, slots: e.target.value })} placeholder="12:00, 17:00, 21:00" /></label>
      <label><span className={label}>{tr("cf.perDay")}</span><input className={field} type="number" min={1} max={12} value={edit.perDay} onKeyDown={enter} onChange={(e) => setEdit({ ...edit, perDay: Number(e.target.value) })} /></label>
      <label><span className={label}>{tr("cf.tz")}</span><input className={field} value={edit.timezone} onKeyDown={enter} onChange={(e) => setEdit({ ...edit, timezone: e.target.value })} placeholder={tr("cf.tzPh")} /></label>
      {err && <p className="error text-[11px]" role="alert">{err}</p>}
      <div className="flex gap-1">
        <button type="button" className="chip" onClick={() => void save()} disabled={busy}>{tr(busy ? "auto.saving" : "habit.save")}</button>
        <button type="button" className="chip" onClick={() => setEdit(null)}>{tr("common.cancel")}</button>
      </div>
    </fieldset>
  );
}

/** "Schedule all approved": the server uploads every approved, unpublished clip into the next free slots, one at a time. */
function ScheduleAll({ count, canUpload, onChange }: { count: number; canUpload: boolean; onChange: (quiet?: boolean) => void }) {
  const { t: tr } = useT();
  const paused = useWorldPaused();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [mine, setMine] = useState(false); // only show a result for a run seen in this panel
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<Schedule>(`${API}/schedule`).then((s) => { setBatch(s.batch); if (s.batch?.running) setMine(true); }, () => {}); }, []);
  useEffect(() => {
    if (!batch?.running || paused) return;
    const t = setInterval(() => { if (!document.hidden) void api<Schedule>(`${API}/schedule`).then((s) => { setBatch(s.batch); onChange(true); }, () => {}); }, 2000);
    return () => clearInterval(t);
  }, [batch?.running, paused, onChange]);
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
  if (batch?.running) return <span className="muted text-[11px]" aria-live="polite">🕒 {tr("cf.scheduling", { a: Math.min(batch.scheduled + 1, batch.total), b: batch.total })}</span>;
  return (
    <div className="flex flex-col items-end gap-0.5">
      {count > 0 && canUpload && <ConfirmButton id="schedule-all" className="btn !px-3 !py-1 !text-xs" label={`🕒 ${tr("cf.scheduleAllN", { n: count })}`} sure={tr("cf.uploadNSure", { n: count })} aria={tr("cf.scheduleAllSlots", { n: count })} onConfirm={() => void start()} disabled={busy} />}
      {mine && batch && (batch.error
        ? <p className="error text-[11px]" role="alert">{tr("cf.scheduledN", { n: batch.scheduled })}. {batch.error}</p>
        : <p className="ok text-[11px]" role="status">✓ {tr("cf.scheduledN", { n: batch.scheduled })}</p>)}
      {err && <p className="error text-[11px]" role="alert">{err}</p>}
    </div>
  );
}
