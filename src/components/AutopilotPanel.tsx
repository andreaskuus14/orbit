"use client";
import { useCallback, useEffect, useState } from "react";

// "🤖 Autopilot" tab of the Clip Factory: sources → candidates → clip jobs → packaging → waiting for you → scheduled → published.
// Data: /api/studio/autopilot (src/lib/clips/autopilot.ts). Nothing is published until the owner presses Approve on a proposal.

// Mirrors src/lib/clips/autopilot-pure.ts (that module imports node code, so it can't be imported here).
type Stage = "found" | "clipping" | "packaging" | "waiting" | "scheduled" | "published" | "failed";
type Proposal = { title: string; titleWhy: string; thumb?: string; description?: string; slot?: string; slotWhy: string };
type PipeClip = { key: string; title: string; stage: Stage; thumb?: string; scheduledFor?: string; videoId?: string };
type Item = { videoId: string; title: string; channel: string; auto: boolean; stage: Stage; detail: string; clips: PipeClip[] };
type Cand = { videoId: string; url: string; title: string; channel: string; apScore: number; why: string[] };
type Layout = "fit" | "fill" | "split" | "follow";
type Data = {
  settings: { auto: boolean; dailyDownloads: number; options: { layout: Layout; camSide: string; captions: boolean } };
  today: { downloads: number; scoutAuto: number; cap: number; left: number };
  scout: { running: boolean; configured: boolean; usedToday: number; budget: number; lastRun?: { at: string; ok: boolean; error?: string; summary?: string }; creators: string[]; keywords: string[] };
  candidates: Cand[]; items: Item[]; counts: Record<Stage, number>; proposals: Record<string, Proposal>;
  working: { n: number; confidence: string; findings: { text: string }[] };
};

const URL_ = "/api/studio/autopilot";
const media = (p: string) => `/api/studio/clips/media?f=${encodeURIComponent(p)}`;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const STEPS: [Stage, string][] = [["found", "Found"], ["clipping", "Clipping"], ["packaging", "Packaging"], ["waiting", "Waiting for you"], ["scheduled", "Scheduled"], ["published", "Published"]];
const LAYOUTS: [Layout, string][] = [["follow", "Follow the action"], ["split", "Split (cam + game)"], ["fill", "Fill"], ["fit", "Fit"]];

async function call<T>(method: string, body?: unknown): Promise<T> {
  const r = await fetch(URL_, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}

export default function AutopilotPanel({ active, onChanged }: { active: boolean; onChanged?: () => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(() => call<Data>("GET").then((x) => { setD(x); setErr(""); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { if (active) void load(); }, [active, load]);
  const working = !!d && (d.scout.running || d.counts.clipping > 0 || d.counts.packaging > 0);
  useEffect(() => { // poll only while this tab is shown and something is moving
    if (!active || !working) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000);
    return () => clearInterval(t);
  }, [active, working, load]);

  async function act(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key); setNote("");
    try { await fn(); if (ok) setNote(ok); await load(); onChanged?.(); }
    catch (e) { setNote(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(""); }
  }
  const patch = (body: Record<string, unknown>) => act("settings", async () => setD(await call<Data>("PATCH", body)));

  if (err && !d) return <section className="card text-xs"><p className="error" role="alert">{err}</p><button className="btn mt-2" onClick={() => void load()}>Try again</button></section>;
  if (!d) return <section className="card text-xs" role="status" aria-label="Loading autopilot"><span className="muted">Loading autopilot…</span></section>;
  const s = d.settings, waiting = d.items.flatMap((i) => i.clips.filter((c) => c.stage === "waiting" && d.proposals[c.key]));

  return (
    <div className="space-y-3 text-xs">
      <section className="card space-y-2" aria-label="Autopilot settings">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="hud-title studio-title !text-[0.7rem]">🤖 YOUTUBE AUTOPILOT</h3>
          <label className="flex items-center gap-2">
            <input type="checkbox" role="switch" checked={s.auto} disabled={busy === "settings"} onChange={(e) => void patch({ auto: e.target.checked })} />
            <span>Auto-clip after each scout run {s.auto ? "(on)" : "(off)"} <span className="muted">· only creators marked auto-clip</span></span>
          </label>
        </div>
        <p className="muted">Finds fresh videos from your creators, clips the best ones and packages them (title, thumbnail, description, slot). <b>Nothing is published until you approve it.</b></p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5">Videos per day
            <select className="chip" value={s.dailyDownloads} disabled={busy === "settings"} onChange={(e) => void patch({ dailyDownloads: Number(e.target.value) })}>
              {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="muted num">(today: {d.today.downloads} autopilot + {d.today.scoutAuto} scout auto-clip of {d.today.cap} shared)</span>
          </label>
          <label className="flex items-center gap-1.5">Layout
            <select className="chip" value={s.options.layout} disabled={busy === "settings"} onChange={(e) => void patch({ options: { layout: e.target.value } })}>
              {LAYOUTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          {s.options.layout === "split" && <label className="flex items-center gap-1.5">Cam
            <select className="chip" value={s.options.camSide} disabled={busy === "settings"} onChange={(e) => void patch({ options: { camSide: e.target.value } })}>
              {["left", "right", "tl", "tr", "bl", "br"].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>}
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.options.captions} disabled={busy === "settings"} onChange={(e) => void patch({ options: { captions: e.target.checked } })} /> Captions</label>
        </div>
        <p className="muted">Sources: {d.scout.creators.length ? d.scout.creators.join(", ") : "no creators yet"}{d.scout.keywords.length ? ` · topics: ${d.scout.keywords.join(", ")}` : ""} — edit them in 🔭 Find videos → Settings.
          {" "}YouTube budget today {d.scout.usedToday}/{d.scout.budget} units.</p>
        <p className="muted">⚖ Clipping other creators&apos; videos is your responsibility: only clip creators who allow it, credit them, and follow YouTube&apos;s copyright and reused-content policies.</p>
      </section>

      <section className="card" aria-label="Pipeline">
        <ol className="flex flex-wrap gap-1.5" aria-label="Pipeline status">
          {STEPS.map(([k, t], i) => <li key={k} className="chip num !px-2 !py-0.5">{i ? "→ " : ""}{t} <b>{d.counts[k]}</b></li>)}
          {d.counts.failed > 0 && <li className="chip num !px-2 !py-0.5 error">Failed <b>{d.counts.failed}</b></li>}
        </ol>
        {note && <p className="mt-2" role="status">{note}</p>}
      </section>

      <section className="card space-y-2" aria-label="Candidates">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="hud-title studio-title !text-[0.7rem]">CANDIDATES</h3>
          <button className="btn !px-3 !py-1 !text-xs" disabled={!!busy || d.scout.running || !d.scout.configured} onClick={() => void act("find", () => call("POST", { action: "find" }), "Looking for new videos…")}>
            {d.scout.running ? "Searching…" : "🔭 Find candidates"}</button>
        </div>
        {!d.scout.configured && <p>Add YOUTUBE_API_KEY to .env.local so ORBIT can read your creators&apos; uploads.</p>}
        {d.scout.lastRun && <p className="muted">{d.scout.lastRun.ok ? d.scout.lastRun.summary : `Last search failed: ${d.scout.lastRun.error}`}</p>}
        {!d.candidates.length ? <p className="muted">No new candidates. Find candidates, or add creators first.</p> : (
          <ol className="space-y-2">
            {d.candidates.map((c) => (
              <li key={c.videoId} className="flex items-start gap-2">
                <span className="num chip !px-1.5" aria-label={`Score ${c.apScore}`}>{c.apScore}</span>
                <div className="min-w-0 flex-1">
                  <a href={c.url} target="_blank" rel="noreferrer" className="underline">{c.title}</a> <span className="muted">· {c.channel}</span>
                  <p className="muted">{c.why.join(" · ")}</p>
                </div>
                <button className="chip" disabled={!!busy || d.today.left < 1} onClick={() => void act(`clip:${c.videoId}`, () => call("POST", { action: "clip", videoIds: [c.videoId] }).then((r) => {
                  const x = r as { started: string[]; errors: string[] }; if (x.errors.length) throw new Error(x.errors.join("; "));
                }), "Downloading — clips will appear here when they're ready")} aria-label={`Clip ${c.title}`}>{busy === `clip:${c.videoId}` ? "Starting…" : "✂ Clip it"}</button>
              </li>
            ))}
          </ol>
        )}
        {d.today.left < 1 && <p className="muted">Today&apos;s cap is reached; more tomorrow (or raise Videos per day).</p>}
      </section>

      <section className="card space-y-2" aria-label="Waiting for you">
        <h3 className="hud-title studio-title !text-[0.7rem]">WAITING FOR YOU ({waiting.length})</h3>
        {!waiting.length && <p className="muted">Nothing to approve. Packaged clips land here; to reject or re-edit one, use 🎬 Clips.</p>}
        {waiting.map((c) => { const p = d.proposals[c.key]; return (
          <div key={c.key} className="flex gap-2">
            {p.thumb && /* eslint-disable-next-line @next/next/no-img-element */ <img src={media(p.thumb)} alt="" className="aspect-[9/16] w-14 shrink-0 rounded object-cover" />}
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="font-semibold">{p.title}</p>
              <p className="muted">{p.titleWhy}</p>
              <p><span className="muted">Slot:</span> {p.slot ? when(p.slot) : "none"} <span className="muted">— {p.slotWhy}</span></p>
              {p.description && <p className="muted whitespace-pre-line line-clamp-3">{p.description}</p>}
              <button className="btn !px-3 !py-1 !text-xs" disabled={!!busy} onClick={() => void act(`ok:${c.key}`, () => call("POST", { action: "approve", key: c.key }), "Approved — uploading as private, YouTube publishes it at the slot")}>
                {busy === `ok:${c.key}` ? "Approving…" : "✅ Approve & schedule"}</button>
            </div>
          </div>
        ); })}
      </section>

      {!!d.items.length && <section className="card" aria-label="Autopilot videos">
        <h3 className="hud-title studio-title mb-1 !text-[0.7rem]">VIDEOS</h3>
        <ul className="space-y-1">{d.items.slice(0, 15).map((i) => (
          <li key={i.videoId}><span className={i.stage === "failed" ? "error" : ""}>{STEPS.find(([k]) => k === i.stage)?.[1] ?? "Failed"}</span> · {i.title} <span className="muted">· {i.channel} · {i.detail}{i.auto ? " · auto" : ""}</span></li>
        ))}</ul>
      </section>}

      <section className="card space-y-1" aria-label="What's working">
        <h3 className="hud-title studio-title !text-[0.7rem]">WHAT&apos;S WORKING <span className="muted normal-case">· {d.working.confidence}</span></h3>
        {d.working.findings.length ? <ul className="list-disc pl-4">{d.working.findings.map((f) => <li key={f.text}>{f.text}</li>)}</ul>
          : <p className="muted">{d.working.n < 2 ? "Not enough published Shorts with 3-day stats yet." : "No clear pattern yet — your Shorts perform about the same across creators, lengths and titles."}</p>}
        <p className="muted">Numbers are pulled toward your channel&apos;s usual until there are more Shorts, so one lucky video can&apos;t steer everything.</p>
      </section>
    </div>
  );
}
