"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { bytes, isJobActive, mmss, parseClipUrl } from "@/lib/clips/format";

// STUDIO clip factory: turn long videos from the inbox folder into 9:16 short clips, review and approve them.
// Data: /api/studio/clips (server owned elsewhere). Mounted inside `.studio`, fills its container like StudioStats.

// Mirrors src/lib/clips/types.ts (declared here so this file stands alone).
type ClipStatus = "rendering" | "ready" | "failed" | "approved" | "rejected";
type Clip = { id: string; start: number; end: number; title: string; hook: string; reason: string; score: number;
  status: ClipStatus; video?: string; thumb?: string; error?: string; publish?: ClipPublish };
type ClipPublish = { status: "uploading" | "done" | "failed"; progress?: number; videoId?: string; url?: string; privacy?: string; error?: string; at: string };
type YtStatus = { configured: boolean; connected: boolean; canUpload?: boolean };
type PublishBody = { title: string; description: string; privacy: "private" | "unlisted" | "public"; publishAt?: string };
type JobStatus = "queued" | "probing" | "transcribing" | "finding" | "rendering" | "done" | "failed";
type ClipJob = { id: string; source: string; createdAt: string; updatedAt: string; status: JobStatus; progress: number; step: string;
  durationSec?: number; error?: string; warnings: string[]; clips: Clip[]; options: { count: number; maxSec: number; captions: boolean } };
type InboxFile = { name: string; size: number; mtime: string; jobId?: string; permission?: string };
type ToolsStatus = { ffmpeg: boolean; transcriber: boolean; ytdlp: boolean; missing: string[] };
type Download = { id: string; url: string; status: "queued" | "downloading" | "done" | "failed"; progress: number; step: string; file?: string; error?: string;
  createdAt: string; permission: string; autoClip?: ClipJob["options"] };
type Data = { root: string; tools: ToolsStatus; inbox: InboxFile[]; jobs: ClipJob[]; downloads: Download[] };
type Opts = ClipJob["options"];

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

/** Two-click confirm without window.confirm: first click arms ("Sure?"), second runs; blur or 4 s disarms. */
function ConfirmButton({ label, sure = "Sure?", aria, onConfirm, disabled, className = "chip" }: { label: string; sure?: string; aria: string; onConfirm: () => void; disabled?: boolean; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return (
    <button className={className} disabled={disabled} onBlur={() => setArmed(false)} aria-label={armed ? `Confirm: ${aria}` : aria}
      style={armed ? { borderColor: "#fb7185" } : undefined} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? sure : label}
    </button>
  );
}

/* ---------- panel ---------- */

export default function ClipFactory({ reduced, onClose }: { reduced: boolean; onClose?: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<Record<string, Opts>>({}); // source → options that got a 409
  const [form, setForm] = useState<string | null>(null);
  const [opts, setOpts] = useState<Opts>({ count: 5, maxSec: 45, captions: true });
  const [showRejected, setShowRejected] = useState(false);
  const [visible, setVisible] = useState(true);
  const [yt, setYt] = useState<YtStatus | null>(null);
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
  const active = !!data?.jobs.some((j) => isJobActive(j) || j.clips.some((c) => c.publish?.status === "uploading")) || !!data?.downloads?.some((d) => d.status === "queued" || d.status === "downloading");
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

  const make = (source: string, o: Opts, force = false) => act(`make:${source}`, async () => {
    try {
      await api(API, { method: "POST", body: { source, count: o.count, maxSec: o.maxSec, captions: o.captions, ...(force ? { force: true } : {}) } });
      setForm(null); setConflict((c) => { const n = { ...c }; delete n[source]; return n; });
      await load(true);
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) { setConflict((c) => ({ ...c, [source]: o })); return; }
      throw e;
    }
  });

  const patchClip = (job: string, clip: string, body: { status?: "approved" | "rejected"; title?: string }) => act(`clip:${job}/${clip}`, async () => {
    const { clip: next } = await api<{ clip: Clip }>(`${API}/${encodeURIComponent(job)}/${encodeURIComponent(clip)}`, { method: "PATCH", body });
    seq.current++; // a poll already in flight carries the pre-edit state: drop it
    setData((d) => d && { ...d, jobs: d.jobs.map((j) => (j.id !== job ? j : { ...j, clips: j.clips.map((c) => (c.id === clip ? next : c)) })) });
  });

  const publish = (job: string, clip: string, body: PublishBody) => act(`pub:${job}/${clip}`, async () => {
    const { clip: next } = await api<{ clip: Clip }>(`${API}/${encodeURIComponent(job)}/${encodeURIComponent(clip)}/publish`, { method: "POST", body });
    seq.current++;
    setData((d) => d && { ...d, jobs: d.jobs.map((j) => (j.id !== job ? j : { ...j, clips: j.clips.map((c) => (c.id === clip ? next : c)) })) });
  });

  const del = (job: string) => act(`del:${job}`, async () => {
    await api(`${API}/${encodeURIComponent(job)}`, { method: "DELETE" });
    seq.current++;
    setData((d) => d && { ...d, jobs: d.jobs.filter((j) => j.id !== job), inbox: d.inbox.map((f) => (f.jobId === job ? { ...f, jobId: undefined } : f)) });
  });

  const download = (body: { url: string; permission: string; autoClip?: Opts }, replaces?: string) => act(replaces ? `dl:${replaces}` : "dl", async () => {
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

  return (
    <div className={`studio-clips glass @container h-full w-full overflow-y-auto p-3 sm:p-4 ${reduced ? "" : "panel-in"}`} role="region" aria-label="Clip factory" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="hud-title studio-title truncate">CLIP FACTORY</h2>
        <div className="flex items-center gap-2">
          {active && <span className="muted text-[11px]" aria-live="polite">Working… auto-updating</span>}
          <button className="chip" onClick={() => { void load(); void loadYt(); }} disabled={loading} aria-label="Refresh clip factory">{loading ? "Loading…" : "Refresh"}</button>
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
        <div className="mt-3 space-y-3" aria-label="Loading clip factory">
          <Skeleton h={120} reduced={reduced} /><Skeleton h={90} reduced={reduced} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">{Array.from({ length: 4 }, (_, k) => <Skeleton key={k} h={260} reduced={reduced} />)}</div>
        </div>
      )}

      {data && (
        <div className="mt-3 space-y-3">
          {(!data.tools.ffmpeg || !data.tools.transcriber) && <ToolsBanner tools={data.tools} />}

          <Section title="Inbox">
            <p className="text-sm">Drop long videos into your Studio inbox folder:</p>
            <code className="num mt-1 block overflow-x-auto whitespace-nowrap rounded bg-black/40 p-2 text-xs">{data.root}</code>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button className="chip" onClick={openFolder} disabled={busy.open}>{busy.open ? "Opening…" : "📂 Open inbox folder"}</button>
              {notes.opened && !notes.open && <span className="ok text-xs" role="status">{notes.opened}</span>}
            </div>
            <Note k="open" />
            <p className="muted mt-2 text-xs">Only use videos you own or have permission to clip (your own uploads, or creators who allow clipping).</p>

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
              <p className="muted mt-3 text-sm">The inbox is empty. Drop a video file into the folder, then press Refresh.</p>
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

          <Section title="Clip jobs" right={rejectedCount > 0 && (
            <button className="chip" aria-pressed={showRejected} onClick={() => setShowRejected((s) => !s)}>
              {showRejected ? "Hide" : "Show"} rejected ({rejectedCount})
            </button>
          )}>
            {!jobs.length && <p className="muted text-sm">No clip jobs yet. Pick a video in the inbox and press “Make clips”.</p>}
            <div className="space-y-3">
              {jobs.map((j) => (
                <JobCard key={j.id} job={j} reduced={reduced} showRejected={showRejected} busy={busy} Note={Note} yt={yt}
                  onRetry={() => make(j.source, j.options, true)} onDelete={() => del(j.id)}
                  onPatch={(clip, body) => patchClip(j.id, clip, body)} onPublish={(clip, body) => publish(j.id, clip, body)} />
              ))}
            </div>
          </Section>
        </div>
      )}
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

function Progress({ pct, step, label, reduced }: { pct: number; step: string; label: string; reduced: boolean }) {
  return (
    <div className="mt-2">
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct}% · ${step}`}
        className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,214,224,0.08)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #800f2f, #ff2e63)", transition: reduced ? "none" : "width 0.4s" }} />
      </div>
      <p className="muted mt-1 text-xs"><span className="num">{pct}%</span> · {step}</p>
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
  const okUrl = parseClipUrl(url.trim());
  const submit = async () => {
    if (!okUrl) return;
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
        </div>
      )}
      <button type="submit" className="btn" disabled={busy || !okUrl || !tools.ytdlp || !tools.ffmpeg}>{busy ? "Adding…" : "⬇ Download"}</button>
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

function Choice({ legend, values, value, fmt, onChange }: { legend: string; values: number[]; value: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <fieldset>
      <legend className="muted mb-1 text-[10px] uppercase tracking-widest">{legend}</legend>
      <div className="flex gap-1">
        {values.map((v) => <button key={v} type="button" className="chip num" aria-pressed={value === v} onClick={() => onChange(v)}>{fmt(v)}</button>)}
      </div>
    </fieldset>
  );
}

/* ---------- jobs & clips ---------- */

type PatchFn = (clip: string, body: { status?: "approved" | "rejected"; title?: string }) => Promise<boolean>;
type PublishFn = (clip: string, body: PublishBody) => Promise<boolean>;

function JobCard({ job, reduced, showRejected, busy, Note, yt, onRetry, onDelete, onPatch, onPublish }: {
  job: ClipJob; reduced: boolean; showRejected: boolean; busy: Record<string, boolean>; Note: (p: { k: string }) => ReactNode; yt: YtStatus | null;
  onRetry: () => void; onDelete: () => void; onPatch: PatchFn; onPublish: PublishFn;
}) {
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
                publish={c.status === "approved" && <PublishBox clip={c} yt={yt} reduced={reduced} busy={!!busy[`pub:${job.id}/${c.id}`]} onPublish={onPublish} note={<Note k={`pub:${job.id}/${c.id}`} />} />} />
            </li>
          ))}
        </ul>
      )}
      {!clips.length && job.status === "done" && <p className="muted mt-2 text-xs">{hidden ? `All ${hidden} clips are rejected (use “Show rejected”).` : "No clips were found in this video."}</p>}
    </article>
  );
}

function ClipCard({ clip: c, busy, onPatch, note, publish }: { clip: Clip; busy: boolean; onPatch: PatchFn; note: ReactNode; publish: ReactNode }) {
  const [play, setPlay] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
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
          <button className="group grid h-full w-full place-items-center" onClick={() => setPlay(true)} aria-label={`Play clip: ${c.title}`}>
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

      <Status text={CLIP_LABEL[c.status] ?? c.status} tone={toneOf(c.status)} />

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
      {c.hook && <p className="leading-snug">“{c.hook}”</p>}
      {c.reason && <p className="muted text-[11px] leading-snug">{c.reason}</p>}
      <p className="muted num text-[11px]">{mmss(c.start)}–{mmss(c.end)} · {mmss(len)} · score {score(c.score)}/100</p>

      <div className="mt-auto flex flex-wrap gap-1">
        {reviewable && (
          <>
            {c.status !== "rejected" && <button className="chip" onClick={() => onPatch(c.id, { status: "approved" })} disabled={busy || c.status === "approved"} aria-pressed={c.status === "approved"} aria-label={`Approve ${c.title}`}>✓ Approve</button>}
            {c.status !== "rejected" && <ConfirmButton label="✕ Reject" aria={`Reject ${c.title}`} onConfirm={() => void onPatch(c.id, { status: "rejected" })} disabled={busy || c.publish?.status === "uploading"} />}
          </>
        )}
        {c.video && <a className="chip" href={media(c.video)} download aria-label={`Download ${c.title}`}>⬇ Download</a>}
      </div>
      {note}
      {publish}
    </div>
  );
}

const LOCKED_NOTE = "Google keeps API uploads from unverified apps private. If YouTube locks it as private, open it in YouTube Studio and set it to Public.";
const PUB_BOX = { background: "rgba(255,143,171,0.12)", color: "#ffd6e0" };
const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
/** datetime-local value ("YYYY-MM-DDTHH:mm", local time) for a Date. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function PublishBox({ clip: c, yt, reduced, busy, onPublish, note }: { clip: Clip; yt: YtStatus | null; reduced: boolean; busy: boolean; onPublish: PublishFn; note: ReactNode }) {
  const [form, setForm] = useState<PublishBody | null>(null);
  const [at, setAt] = useState("");
  const p = c.publish;
  const open = () => { setAt(""); setForm({ title: c.title.replace(/[<>]/g, "").slice(0, 100), description: `${c.hook.replace(/[<>]/g, "")}\n\n#shorts`.trim(), privacy: "private" }); };
  const submit = async () => {
    if (!form) return;
    if (await onPublish(c.id, { ...form, ...(at ? { publishAt: new Date(at).toISOString() } : {}) })) setForm(null);
  };
  const reconnect = (text: string) => <p className="rounded-md px-1.5 py-1 text-[11px]" style={PUB_BOX}>{text} <a className="underline" href="/api/studio/oauth/start">Connect YouTube</a></p>;

  if (p?.status === "uploading") {
    return <Progress pct={Math.round(Math.min(1, Math.max(0, p.progress ?? 0)) * 100)} step="Uploading to YouTube" label={`Upload progress for ${c.title}`} reduced={reduced} />;
  }
  if (p?.status === "done" && p.videoId) {
    return (
      <div className="space-y-1 rounded-md px-1.5 py-1 text-[11px]" style={PUB_BOX} role="status">
        <p>✓ On YouTube{p.privacy ? ` · ${p.privacy}` : ""}</p>
        <a className="block underline" href={`https://youtube.com/shorts/${p.videoId}`} {...ext}>Open on YouTube ↗</a>
        <a className="block underline" href={`https://studio.youtube.com/video/${p.videoId}/edit`} {...ext}>Open in YouTube Studio ↗</a>
        <p className="muted">{LOCKED_NOTE}</p>
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
  return (
    <form className="flex flex-col gap-1.5 rounded-md border border-white/10 p-1.5" aria-label={`Publish ${c.title} to YouTube`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label><span className={label}>Title</span>
        <input className="field w-full !px-2 !py-1 !text-xs" value={form.title} maxLength={100} required onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label><span className={label}>Description</span>
        <textarea className="field w-full !px-2 !py-1 !text-xs" rows={3} value={form.description} maxLength={5000} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <label><span className={label}>Visibility</span>
        <select className="field w-full !px-2 !py-1 !text-xs" value={form.privacy} disabled={!!at} onChange={(e) => set({ privacy: e.target.value as PublishBody["privacy"] })}>
          <option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option>
        </select>
      </label>
      <label><span className={label}>Schedule (optional)</span>
        <input className="field w-full !px-2 !py-1 !text-xs" type="datetime-local" value={at} min={localInput(new Date())} onChange={(e) => setAt(e.target.value)} />
      </label>
      {at && <p className="muted text-[11px]">Stays private until then, then goes public.</p>}
      {/[<>]/.test(form.title + form.description) && <p className="error text-[11px]">YouTube doesn&apos;t allow &lt; or &gt;.</p>}
      <p className="muted text-[11px]">{LOCKED_NOTE}</p>
      <div className="flex gap-1">
        <button type="submit" className="chip" disabled={busy || !form.title.trim() || /[<>]/.test(form.title + form.description)}>{busy ? "Starting…" : "▶ Upload"}</button>
        <button type="button" className="chip" onClick={() => setForm(null)}>Cancel</button>
      </div>
      {note}
    </form>
  );
}
