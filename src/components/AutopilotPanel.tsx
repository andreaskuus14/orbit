"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorldPaused } from "./world-paused";
import { useT } from "./i18n";
import { avatar, multBars, nextAction, type Pref } from "@/lib/clips/autopilot-ui";

// "🤖 Autopilot" tab of the Clip Factory: a status hero (switch, daily cap ring, next action, clickable pipeline), the clips waiting for
// approval as big cards (A approve · S skip · ←/→), ranked candidates, what's working as bar charts, and the settings in a drawer.
// Data: /api/studio/autopilot (src/lib/clips/autopilot.ts). Nothing is published until the owner presses Approve on a proposal.

// Mirrors src/lib/clips/autopilot-pure.ts (that module imports node code, so it can't be imported here).
type Stage = "found" | "clipping" | "packaging" | "waiting" | "scheduled" | "published" | "failed";
type Proposal = { title: string; titleWhy: string; thumb?: string; description?: string; slot?: string; slotWhy: string; alts?: string[]; notes?: string[]; video?: string };
type PipeClip = { key: string; title: string; stage: Stage; thumb?: string; scheduledFor?: string; videoId?: string };
type Item = { videoId: string; title: string; channel: string; auto: boolean; stage: Stage; detail: string; clips: PipeClip[] };
type Cand = { videoId: string; url: string; title: string; channel: string; apScore: number; why: string[] };
type Layout = "fit" | "fill" | "split" | "follow";
type Dims = Partial<Record<"creator" | "length" | "hour", Record<string, Pref>>>;
type Data = {
  settings: { auto: boolean; dailyDownloads: number; options: { layout: Layout; camSide: string; captions: boolean } };
  today: { downloads: number; scoutAuto: number; cap: number; left: number };
  scout: { running: boolean; configured: boolean; usedToday: number; budget: number; lastRun?: { at: string; ok: boolean; error?: string; summary?: string };
    creators: string[]; keywords: string[]; runAt: number; lastScheduled?: string };
  candidates: Cand[]; items: Item[]; counts: Record<Stage, number>; proposals: Record<string, Proposal>; slots?: string[];
  working: { n: number; confidence: string; findings: { text: string }[]; dims?: Dims };
};
type Waiting = PipeClip & { p: Proposal };

const URL_ = "/api/studio/autopilot";
const media = (p: string) => `/api/studio/clips/media?f=${encodeURIComponent(p)}`;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const hhmm = (d: Date) => d.toLocaleString([], { weekday: d.toDateString() === new Date().toDateString() ? undefined : "short", hour: "2-digit", minute: "2-digit" });
const STEPS: [Stage, string, string][] = [["found", "Found", "🔭"], ["clipping", "Clipping", "✂"], ["packaging", "Packaging", "📦"], ["waiting", "Waiting for you", "👀"], ["scheduled", "Scheduled", "🕒"], ["published", "Published", "🚀"]];
const LAYOUTS: [Layout, string][] = [["follow", "Follow the action"], ["split", "Split (cam + game)"], ["fill", "Fill"], ["fit", "Fit"]];
const H = "hud-title studio-title !text-[0.7rem]";

async function call<T>(method: string, body?: unknown, url = URL_): Promise<T> {
  const r = await fetch(url, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}

export default function AutopilotPanel({ active: tabOn, onChanged, onOpenClip, onOpenFind }: {
  active: boolean; onChanged?: () => void; onOpenClip?: (job: string, clip: string) => void; onOpenFind?: () => void;
}) {
  const paused = useWorldPaused(), active = tabOn && !paused; // STUDIO kept but hidden: no polling, no keys
  const { t: tr } = useT();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<Stage | null>(null);
  const [atKey, setAtKey] = useState(""); // focused waiting card (by key: the list reorders/shrinks under it)
  const [armed, setArmed] = useState(""); // "ok:<key>" / "skip:<key>": key A and Skip arm first, a second press within 5 s confirms
  const root = useRef<HTMLDivElement>(null);
  const load = useCallback(() => call<Data>("GET").then((x) => { setD(x); setErr(""); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { if (active) void load(); }, [active, load]);
  const working = !!d && (d.scout.running || d.counts.clipping > 0 || d.counts.packaging > 0);
  const every = !d ? 0 : d.scout.running || d.counts.clipping > 0 ? 5000 : d.counts.packaging > 0 ? 20_000 : 0; // packaging alone is slow (Claude calls)
  useEffect(() => { // poll only while this tab is shown and something is moving
    if (!active || !every) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, every);
    return () => clearInterval(t);
  }, [active, every, load]);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(""), 5000); return () => clearTimeout(t); }, [armed]);

  const act = useCallback(async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key); setNote(""); setArmed("");
    try { const r = await fn(); if (ok) setNote(ok); if (r && typeof r === "object" && "counts" in r) setD(r as Data); else await load(); onChanged?.(); } // edits return the fresh view
    catch (e) { setNote(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(""); }
  }, [load, onChanged]);
  const patch = (body: Record<string, unknown>) => act("settings", () => call<Data>("PATCH", body));

  const waiting: Waiting[] = d ? d.items.flatMap((i) => i.clips.filter((c) => c.stage === "waiting" && d.proposals[c.key]).map((c) => ({ ...c, p: d.proposals[c.key] }))) : [];
  const cur = waiting.find((w) => w.key === atKey) ?? waiting[0];
  const notes = useRef<Record<string, string>>({}); // "What I added" per waiting clip (sent with approve; the server requires it for other creators' clips)
  const approve = useCallback((w: Waiting) => { const original = notes.current[w.key]?.trim();
    return act(`ok:${w.key}`, () => call("POST", { action: "approve", key: w.key, ...(original ? { original } : {}) }), "✅ Approved: uploading as private, YouTube publishes it at the slot"); }, [act]);
  const skip = useCallback((w: Waiting) => {
    if (armed !== `skip:${w.key}`) { setArmed(`skip:${w.key}`); return; }
    const [job, clip] = w.key.split("/");
    void act(`skip:${w.key}`, () => call("PATCH", { status: "rejected" }, `/api/studio/clips/${job}/${clip}`), "Skipped");
  }, [act, armed]);
  const curKey = cur?.key;
  const move = useCallback((dir: number) => {
    setArmed("");
    const i = waiting.findIndex((w) => w.key === curKey);
    if (waiting.length) setAtKey(waiting[(Math.max(0, i) + dir + waiting.length) % waiting.length].key);
  }, [waiting, curKey]);

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (!active || !cur || busy || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
    if (!t || !root.current?.contains(t) || /^(INPUT|TEXTAREA|SELECT|VIDEO)$/.test(t.tagName) || t.isContentEditable) return; // only with focus in this panel
    if (document.querySelector(".drawer:not(.drawer-out), dialog[open], .review-queue, [popover]:popover-open")) return; // CORE / a dialog is on top
    const k = e.key.toLowerCase();
    const okA = () => { if (armed === `ok:${cur.key}`) void approve(cur); else setArmed(`ok:${cur.key}`); }; // never approve on one stray key
    const fn = k === "a" ? okA : k === "s" ? () => skip(cur) : k === "arrowright" ? () => move(1) : k === "arrowleft" ? () => move(-1) : null;
    if (fn) { e.preventDefault(); e.stopPropagation(); fn(); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    addEventListener("keydown", h, true);
    return () => removeEventListener("keydown", h, true);
  }, []);

  if (err && !d) return <section className="card text-xs"><p className="error" role="alert">{err}</p><button className="btn mt-2" onClick={() => void load()}>{tr("task.retry")}</button></section>;
  if (!d) return <section className="card text-xs" role="status" aria-label={tr("ap.loading")}><span className="muted">{tr("ap.loading")}…</span></section>;
  const s = d.settings, show = (st: Stage) => !filter || filter === st;
  const used = d.today.downloads + d.today.scoutAuto, cap = d.today.cap;
  const next = nextAction({ waiting: waiting.length, clipping: d.counts.clipping, packaging: d.counts.packaging, candidates: d.candidates.length, running: d.scout.running,
    configured: d.scout.configured, creators: d.scout.creators.length, auto: s.auto, left: d.today.left, runAt: d.scout.runAt, lastScheduled: d.scout.lastScheduled }, new Date(), hhmm);
  const pipeFilter = filter && !["found", "waiting"].includes(filter) ? filter : null;
  const pipeRows = pipeFilter ? d.items.flatMap((i) => i.clips.length ? i.clips.filter((c) => c.stage === pipeFilter).map((c) => ({ key: c.key, title: c.title, sub: `${i.channel}${c.scheduledFor ? ` · ${when(c.scheduledFor)}` : ""}`, thumb: c.thumb }))
    : i.stage === pipeFilter ? [{ key: i.videoId, title: i.title, sub: `${i.channel} · ${i.detail}`, thumb: undefined }] : []) : [];

  return (
    <div ref={root} className="space-y-3 text-xs">
      {/* ---- status hero ---- */}
      <section className="card relative overflow-hidden !p-3 sm:!p-4" aria-label={tr("ap.status")}
        style={{ background: s.auto ? "radial-gradient(120% 140% at 0% 0%, rgba(255,46,99,0.22), transparent 55%), linear-gradient(165deg, rgba(255,214,224,0.07), rgba(30,4,14,0.55))" : undefined }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <button role="switch" aria-checked={s.auto} disabled={busy === "settings"} onClick={() => void patch({ auto: !s.auto })}
            className="flex items-center gap-3 rounded-full border px-2 py-1.5 pr-4 transition" aria-label={tr("ap.switchAria", { state: tr(s.auto ? "common.on" : "common.off") })}
            style={{ borderColor: s.auto ? "#ff2e63" : "rgba(255,143,171,0.25)", boxShadow: s.auto ? "0 0 22px rgba(255,46,99,0.45)" : "none", background: "rgba(20,2,10,0.5)" }}>
            <span className="relative h-7 w-12 rounded-full transition" style={{ background: s.auto ? "linear-gradient(90deg,#c9184a,#ff2e63)" : "rgba(255,255,255,0.12)" }}>
              <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all" style={{ left: s.auto ? "1.375rem" : "0.125rem" }} />
            </span>
            <span className="text-left leading-tight">
              <span className="studio-title block text-lg font-bold tracking-[0.2em]" style={{ fontFamily: "var(--font-display)" }}>{tr(s.auto ? "ap.on" : "ap.off")}</span>
              <span className="muted block text-[10px]">{tr(s.auto ? "ap.onHint" : "ap.offHint")}</span>
            </span>
          </button>

          <div className="flex items-center gap-2" role="img" aria-label={tr("ap.todayAria", { n: used, cap })}>
            <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
              <circle cx="28" cy="28" r="23" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
              <circle cx="28" cy="28" r="23" fill="none" stroke="#ff2e63" strokeWidth="6" strokeLinecap="round" transform="rotate(-90 28 28)"
                strokeDasharray={`${cap ? Math.min(1, used / cap) * 144.5 : 0} 144.5`} style={{ filter: "drop-shadow(0 0 4px rgba(255,46,99,0.7))", transition: "stroke-dasharray 0.6s" }} />
              <text x="28" y="32" textAnchor="middle" className="num" fill="#ffe5ec" fontSize="13" fontWeight="700">{used}/{cap}</text>
            </svg>
            <span className="leading-tight"><span className="muted block text-[10px] uppercase tracking-widest">{tr("ap.today")}</span><b className="num">{used}/{cap}</b> {tr("ap.videos")}</span>
          </div>

          <p className="min-w-[12rem] flex-1 text-sm font-semibold" role="status" aria-live="polite">
            {working && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-[#ff2e63] align-middle motion-reduce:animate-none" aria-hidden />}
            {next}
          </p>
        </div>

        <ol className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-6" aria-label={tr("ap.pipeline")}>
          {STEPS.map(([k, t, icon]) => (
            <li key={k}>
              <button className="chip flex w-full flex-col items-center !rounded-xl !px-1 !py-1.5" aria-pressed={filter === k} onClick={() => setFilter(filter === k ? null : k)}
                aria-label={`${t}: ${d.counts[k]}. ${tr(filter === k ? "ap.showAll" : "ap.showStage")}`}>
                <span className="num text-base font-bold leading-none" style={{ color: d.counts[k] ? (k === "waiting" ? "#ff8fab" : "#ffe5ec") : "var(--muted)" }}>{d.counts[k]}</span>
                <span className="mt-0.5 whitespace-nowrap text-[10px]"><span aria-hidden>{icon} </span>{t}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {d.counts.failed > 0 && <button className="chip error !px-2 !py-0.5" aria-pressed={filter === "failed"} onClick={() => setFilter(filter === "failed" ? null : "failed")}>⚠ {tr("ap.failed", { n: d.counts.failed })}</button>}
          {filter && <button className="chip !px-2 !py-0.5" onClick={() => setFilter(null)}>{tr("ap.showAll")}</button>}
        </div>
        {note && <p className="mt-2" role="status">{note}</p>}
      </section>

      {/* ---- waiting for you ---- */}
      {show("waiting") && <section className="card space-y-2" aria-label={tr("ap.waiting")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={H}>👀 {tr("ap.waiting").toUpperCase()} <span className="num">({waiting.length})</span></h3>
          {waiting.length > 0 && <div className="flex items-center gap-1.5">
            <span className="muted hidden sm:inline"><kbd>A</kbd> <kbd>A</kbd> {tr("ap.kApprove")} · <kbd>S</kbd> <kbd>S</kbd> {tr("ap.kSkip")} · <kbd>←</kbd><kbd>→</kbd></span>
            {waiting.length > 1 && <><button className="chip !px-2" onClick={() => move(-1)} aria-label={tr("ap.prev")}>←</button>
              <span className="num" aria-label={tr("ap.clipOf", { n: waiting.indexOf(cur) + 1, total: waiting.length })}>{waiting.indexOf(cur) + 1}/{waiting.length}</span>
              <button className="chip !px-2" onClick={() => move(1)} aria-label={tr("ap.next")}>→</button></>}
          </div>}
        </div>
        {!cur ? <p className="muted py-3 text-center text-sm">
          {d.counts.packaging + d.counts.clipping ? `📦 ${tr("ap.onTheWay", { n: d.counts.packaging + d.counts.clipping })}`
            : tr(d.candidates.length ? "ap.nothingYet" : "ap.nothing")}</p>
          : <WaitingCard key={cur.key} w={cur} note={notes.current[cur.key] ?? ""} onNote={(t) => { notes.current[cur.key] = t; }} slots={d.slots ?? []} busy={busy} armed={armed === `ok:${cur.key}` ? "ok" : armed === `skip:${cur.key}` ? "skip" : ""} onApprove={() => void approve(cur)} onSkip={() => skip(cur)}
            onEdit={onOpenClip ? () => { const [j, c] = cur.key.split("/"); onOpenClip(j, c); } : undefined}
            onTitle={(title) => void act(`t:${cur.key}`, () => call("POST", { action: "edit", key: cur.key, title }))}
            onSlot={(slot) => void act(`slot:${cur.key}`, () => call("POST", { action: "edit", key: cur.key, slot }), "Slot changed")}
            onReview={() => void act(`rev:${cur.key}`, () => call("POST", { action: "review", key: cur.key }))} />}
        {waiting.length > 1 && <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={tr("ap.allWaiting")}>
          {waiting.map((w, k) => (
            <button key={w.key} onClick={() => { setArmed(""); setAtKey(w.key); }} aria-pressed={w.key === cur?.key} aria-label={tr("ap.show", { title: w.p.title })}
              className="aspect-[9/16] w-10 shrink-0 overflow-hidden rounded border-2" style={{ borderColor: w.key === cur?.key ? "#ff2e63" : "transparent" }}>
              {w.p.thumb ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={media(w.p.thumb)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="num">{k + 1}</span>}
            </button>
          ))}
        </div>}
      </section>}

      {/* ---- candidates ---- */}
      {show("found") && <section className="card space-y-2" aria-label={tr("ap.candidates")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={H}>🔭 {tr("ap.candidates").toUpperCase()}</h3>
          <button className="btn !px-3 !py-1 !text-xs" disabled={!!busy || d.scout.running || !d.scout.configured} onClick={() => void act("find", () => call("POST", { action: "find" }), "Looking for new videos…")}>
            {tr(d.scout.running ? "ap.searching" : "ap.find")}</button>
        </div>
        {d.scout.lastRun && <p className="muted">{d.scout.lastRun.ok ? d.scout.lastRun.summary : <span className="error">{tr("ap.lastFailed")} {d.scout.lastRun.error}</span>}</p>}
        {!d.scout.configured ? <p>{tr("cf.apiKey1")} <code>{"YOUTUBE_API_KEY"}</code> {tr("ap.apiKey2")}</p>
          : !d.scout.creators.length && !d.scout.keywords.length ? <p className="py-2">{tr("ap.noSources")} <button className="chip" onClick={onOpenFind}>➕ {tr("ap.addSources")}</button></p>
          : !d.candidates.length ? <p className="muted py-2">{tr("ap.noNew")}</p> : (
          <ol className="space-y-1.5">
            {d.candidates.map((c, k) => { const av = avatar(c.channel); return (
              <li key={c.videoId} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-white/5">
                <span className="num muted w-4 text-right">{k + 1}</span>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold" aria-hidden style={{ background: `hsl(${av.hue} 70% 40%)`, boxShadow: `0 0 10px hsl(${av.hue} 80% 50% / 0.4)` }}>{av.text}</span>
                <div className="min-w-0 flex-1">
                  <a href={c.url} target="_blank" rel="noreferrer" className="block truncate font-semibold hover:underline">{c.title}</a>
                  <div className="flex items-center gap-2">
                    <span className="muted shrink-0">{c.channel}</span>
                    <span className="hud-bar w-16 shrink-0" style={{ ["--accent" as string]: "#ff2e63" }} role="img" aria-label={tr("cf.score", { n: c.apScore })}><i style={{ width: `${c.apScore}%` }} /></span>
                    <b className="num">{c.apScore}</b>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">{c.why.map((w) => <span key={w} className="rounded-full border border-white/10 px-1.5 text-[10px] text-[#ffd6e0]/80">{w}</span>)}</div>
                </div>
                <button className="chip shrink-0" disabled={!!busy || d.today.left < 1} aria-label={tr("cf.clipAria", { title: c.title })} onClick={() => void act(`clip:${c.videoId}`, () => call("POST", { action: "clip", videoIds: [c.videoId] }).then((r) => {
                  const x = r as { started: string[]; errors: string[] }; if (x.errors.length) throw new Error(x.errors.join("; "));
                }), "Downloading: clips will wait for you when they're ready")}>{busy === `clip:${c.videoId}` ? tr("cf.starting") : `✂ ${tr("cf.clipIt")}`}</button>
              </li>
            ); })}
          </ol>
        )}
        {d.today.left < 1 && <p className="muted">{tr("ap.capReached")}</p>}
      </section>}

      {/* ---- one pipeline stage ---- */}
      {pipeFilter && <section className="card space-y-1.5" aria-label={`${pipeFilter} clips`}>
        <h3 className={H}>{(STEPS.find(([k]) => k === pipeFilter)?.[1] ?? "Failed").toUpperCase()}</h3>
        {!pipeRows.length ? <p className="muted">{tr("ap.empty")}</p> : <ul className="space-y-1.5">{pipeRows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            {r.thumb && /* eslint-disable-next-line @next/next/no-img-element */ <img src={media(r.thumb)} alt="" loading="lazy" className="aspect-[9/16] w-7 shrink-0 rounded object-cover" />}
            <span className="min-w-0 flex-1 truncate">{r.title} <span className="muted">· {r.sub}</span></span>
          </li>))}</ul>}
      </section>}

      {/* ---- what's working ---- */}
      {!filter && <section className="card space-y-2" aria-label={tr("ap.working")}>
        <h3 className={H}>📈 {tr("ap.working").toUpperCase()} <span className="muted normal-case tracking-normal">· {d.working.confidence}</span></h3>
        {d.working.n < 2 ? <p className="muted">{tr("ap.workingWait")}</p> : <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Bars title={tr("cf.creators")} dim="creator" rec={d.working.dims?.creator} />
            <Bars title={tr("ap.clipLen")} dim="length" rec={d.working.dims?.length} />
            <Bars title={tr("ap.hour")} dim="hour" rec={d.working.dims?.hour} />
          </div>
          {d.working.findings.length ? <ul className="list-disc pl-4">{d.working.findings.map((f) => <li key={f.text}>{f.text}</li>)}</ul>
            : <p className="muted">{tr("ap.noPattern")}</p>}
          <p className="muted">{tr("ap.barsHint")}</p>
        </>}
      </section>}

      {/* ---- settings drawer ---- */}
      <details className="card" aria-label={tr("ap.settings")}>
        <summary className="cursor-pointer select-none"><span className={H}>⚙ {tr("cf.settings").toUpperCase()}</span> <span className="muted">· {tr("ap.perDay", { n: s.dailyDownloads })} · {LAYOUTS.find(([v]) => v === s.options.layout)?.[1]}{s.options.captions ? tr("cf.withCaptions") : ""}</span></summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.auto} disabled={busy === "settings"} onChange={(e) => void patch({ auto: e.target.checked })} /> {tr("ap.autoAfter")} <span className="muted">{tr("ap.onlyMarked")}</span></label>
            <label className="flex items-center gap-1.5">{tr("ap.videosPerDay")}
              <select className="chip" value={s.dailyDownloads} disabled={busy === "settings"} onChange={(e) => void patch({ dailyDownloads: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="muted num">{tr("ap.todaySplit", { a: d.today.downloads, s: d.today.scoutAuto })}</span>
            </label>
            <label className="flex items-center gap-1.5">{tr("cf.layout")}
              <select className="chip" value={s.options.layout} disabled={busy === "settings"} onChange={(e) => void patch({ options: { layout: e.target.value } })}>
                {LAYOUTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            {s.options.layout === "split" && <label className="flex items-center gap-1.5">{tr("ap.cam")}
              <select className="chip" value={s.options.camSide} disabled={busy === "settings"} onChange={(e) => void patch({ options: { camSide: e.target.value } })}>
                {["left", "right", "tl", "tr", "bl", "br"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>}
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.options.captions} disabled={busy === "settings"} onChange={(e) => void patch({ options: { captions: e.target.checked } })} /> {tr("cf.captions")}</label>
          </div>
          <p className="muted">{tr("ap.sources")} {d.scout.creators.length ? d.scout.creators.join(", ") : tr("ap.noCreators")}{d.scout.keywords.length ? tr("ap.topics", { list: d.scout.keywords.join(", ") }) : ""}
            {" "}{onOpenFind && <button className="chip !px-2 !py-0.5" onClick={onOpenFind}>{tr("ap.editSources")}</button>}
            {" "}· {tr("ap.budget", { h: String(d.scout.runAt).padStart(2, "0"), used: d.scout.usedToday, max: d.scout.budget })}</p>
          <p className="muted">⚖ {tr("ap.responsibility")}</p>
        </div>
      </details>
    </div>
  );
}

function WaitingCard({ w, note, onNote, slots, busy, armed, onApprove, onSkip, onEdit, onTitle, onSlot, onReview }: {
  w: Waiting; note: string; onNote: (t: string) => void; slots: string[]; busy: string; armed: "" | "ok" | "skip"; onApprove: () => void; onSkip: () => void; onEdit?: () => void;
  onTitle: (t: string) => void; onSlot: (s: string) => void; onReview: () => void;
}) {
  const { t: tr } = useT();
  const p = w.p, vid = useRef<HTMLVideoElement>(null), [playing, setPlaying] = useState(false), [added, setAdded] = useState(note);
  const play = (on: boolean) => { const v = vid.current; if (!v) return; if (on) void v.play().then(() => setPlaying(true), () => {}); else { v.pause(); setPlaying(false); } };
  const any = !!busy;
  return (
    <article className="grid gap-3 sm:grid-cols-[minmax(8rem,11rem)_1fr]" aria-label={tr("ap.waitingAria", { title: p.title })}>
      <div className="relative mx-auto aspect-[9/16] w-40 overflow-hidden rounded-xl border border-[#ff8fab]/30 bg-black sm:w-full" style={{ boxShadow: "0 0 24px rgba(255,46,99,0.25)" }}
        onMouseEnter={() => play(true)} onMouseLeave={() => play(false)}>
        {p.video ? <video ref={vid} src={media(p.video)} poster={p.thumb ? media(p.thumb) : undefined} muted loop playsInline preload="none" className="h-full w-full object-cover" />
          : p.thumb ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={media(p.thumb)} alt="" className="h-full w-full object-cover" /> : null}
        {p.video && <button className="absolute inset-0 grid place-items-center" onClick={() => play(!playing)} aria-label={tr(playing ? "ap.pausePreview" : "ap.playPreview")}>
          {!playing && <span className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-lg backdrop-blur" aria-hidden>▶</span>}</button>}
      </div>

      <div className="min-w-0 space-y-2">
        <div>
          <p className="text-lg font-bold leading-snug text-[#ffe5ec]" style={{ fontFamily: "var(--font-display)" }}>{p.title}</p>
          <p className="muted">{p.titleWhy}</p>
        </div>
        {!!p.alts?.length && <div className="flex flex-wrap items-center gap-1" role="group" aria-label={tr("ap.runnerUps")}>
          <span className="muted">{tr("ap.swap")}</span>
          {p.alts.map((t) => <button key={t} className="chip !px-2 !py-0.5 text-left !text-[11px]" disabled={any} onClick={() => onTitle(t)} aria-label={tr("ap.useTitle", { t })}>↔ {t}</button>)}
        </div>}
        {p.notes?.length ? <ul className="space-y-0.5 rounded-lg border border-[#ff8fab]/20 bg-[#ff2e63]/5 p-2" aria-label={tr("ap.critics")}>
          {p.notes.map((n, k) => <li key={k}><span aria-hidden>🧐 </span>{n}</li>)}
        </ul> : <button className="chip !px-2 !py-0.5" disabled={any} onClick={onReview}>{busy === `rev:${w.key}` ? tr("ap.criticsReading") : `🧐 ${tr("ap.reviewTitles")}`}</button>}
        <label className="flex flex-wrap items-center gap-1.5"><span className="muted">{tr("ap.slot")}</span>
          <select className="chip" value={p.slot ?? ""} disabled={any} onChange={(e) => onSlot(e.target.value)}>
            {!p.slot && <option value="">{tr("ap.noneFree")}</option>}
            {p.slot && <option value={p.slot}>{when(p.slot)}</option>}
            {slots.filter((x) => x !== p.slot).map((x) => <option key={x} value={x}>{when(x)}</option>)}
          </select>
          <span className="muted">{p.slotWhy}</span>
        </label>
        {p.description && <details><summary className="muted cursor-pointer">{tr("cf.description")}</summary><p className="mt-1 whitespace-pre-line">{p.description}</p></details>}
        <label className="block"><span className="muted">{tr("ap.whatAdded")}</span>
          <input className="field mt-0.5 w-full !px-2 !py-1" value={added} maxLength={200} disabled={any} placeholder={tr("ap.whatAddedPh")}
            onChange={(e) => { setAdded(e.target.value); onNote(e.target.value); }} />
          <span className="muted text-[11px]">{tr("ap.ownLayer")}</span>
        </label>
        <div className="flex flex-wrap gap-2 pt-1">
          <button className="btn !px-4 !py-2 !text-sm" disabled={any || !p.slot} onClick={onApprove} style={armed === "ok" ? { outline: "2px solid #ffe5ec", outlineOffset: 2, boxShadow: "0 0 30px rgba(255,46,99,0.8)" } : undefined}>{busy === `ok:${w.key}` ? tr("ap.approving") : `✅ ${tr("ap.approveSchedule")}`} <kbd className="ml-1 hidden sm:inline">A</kbd></button>
          <button className={`chip !px-4 !py-2 ${armed === "skip" ? "error" : ""}`} disabled={any} onClick={onSkip} style={armed === "skip" ? { borderColor: "#fb7185" } : undefined}>
            {tr(busy === `skip:${w.key}` ? "ap.skipping" : armed === "skip" ? "ap.reallySkip" : "brief.skip")} <kbd className="ml-1 hidden sm:inline">S</kbd></button>
          {onEdit && <button className="chip !px-4 !py-2" disabled={any} onClick={onEdit}>✏ {tr("auto.editBtn")}</button>}
        </div>
        <p role="status" className={armed ? "font-semibold text-[#ffd6e0]" : "sr-only"}>
          {armed === "ok" ? tr("ap.armedOk") : armed === "skip" ? tr("ap.armedSkip") : ""}</p>
      </div>
    </article>
  );
}

function Bars({ title, dim, rec }: { title: string; dim: "creator" | "length" | "hour"; rec?: Record<string, Pref> }) {
  const { t: tr } = useT();
  const { bars, one } = multBars(dim, rec);
  return (
    <figure className="rounded-lg border border-white/10 p-2">
      <figcaption className="muted mb-1 text-[10px] uppercase tracking-widest">{title}</figcaption>
      {!bars.length ? <p className="muted">{tr("ap.noData")}</p> : <ul className="space-y-1">{bars.map((b) => (
        <li key={b.label} className="grid grid-cols-[minmax(0,5rem)_1fr_2rem_3.6rem] items-center gap-1.5" aria-label={`${b.label}: ${b.mult.toFixed(2)}× usual views, ${b.n} Shorts, ${b.badge} signal`}>
          <span className="truncate" title={b.label}>{b.label}</span>
          <span className="relative h-2.5 rounded-full bg-white/5" aria-hidden>
            <i className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${b.width}%`, background: b.mult >= 1 ? "linear-gradient(90deg,#c9184a,#ff2e63)" : "rgba(142,163,196,0.55)", opacity: b.badge === "guess" || b.badge === "weak" ? 0.55 : 1 }} />
            <i className="absolute -inset-y-0.5 w-px bg-white/60" style={{ left: `${one}%` }} />
          </span>
          <span className="num text-right">{b.mult.toFixed(1)}×</span>
          <span className="rounded-full border px-1 text-center text-[9px]" title={`${b.n} Shorts`}
            style={{ borderColor: b.badge === "solid" ? "#6ee7b7" : b.badge === "moderate" ? "#fbbf24" : "rgba(255,255,255,0.2)", color: b.badge === "solid" ? "#6ee7b7" : b.badge === "moderate" ? "#fbbf24" : "var(--muted)" }}>{b.badge} · {b.n}</span>
        </li>))}</ul>}
    </figure>
  );
}
