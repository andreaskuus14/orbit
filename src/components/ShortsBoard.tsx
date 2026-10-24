"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { STAGES, pipelineCards, validTarget, weekProgress, weekStartOf, type Card, type Open, type PIdea, type PJob, type PStory, type Stage } from "@/lib/clips/pipeline-pure";

// Clip Factory → "Pipeline": every Short from idea to its live slot, the weekly target, and the packaging scorer for the title A/B.
// Data: the clip jobs ClipFactory already loaded + GET /api/ideas (Idea Radar) + GET /api/studio/clips/story (AI Story).
// Scoring: POST /api/studio/packaging. Cards only open the existing tools; approving and scheduling stay the owner's own clicks there.

const LABEL: Record<Stage, string> = { idea: "Idea", script: "Script", clip: "Clip / story", package: "Thumb + title A/B", review: "Review", scheduled: "Scheduled" };
const PER_STAGE = 6;
const TARGET_KEY = "orbit.shortsBoard.target";
type Ranked = { rank: number; title: string; predictedCtr: number; interval: { low: number; high: number }; reasons: string[] };
type Scored = { connected: boolean; reason?: "not_configured" | "not_connected" | "no_channel" | "error"; message?: string; samples: number; mode: "prior" | "fitted"; ranked: Ranked[] };

async function getJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body ? { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const day = new Intl.DateTimeFormat([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

export default function ShortsBoard({ jobs, active, reduced, onOpen, onPickTitle, onMoreTitles }: {
  jobs: PJob[]; active: boolean; reduced: boolean; onOpen: (o: Open) => void;
  onPickTitle: (job: string, clip: string, title: string) => Promise<boolean>; onMoreTitles: (job: string, clip: string) => Promise<boolean>;
}) {
  const [ideas, setIdeas] = useState<PIdea[]>([]);
  const [stories, setStories] = useState<PStory[]>([]);
  const [warn, setWarn] = useState("");
  const [target, setTarget] = useState(() => { try { return validTarget(localStorage.getItem(TARGET_KEY) ?? undefined); } catch { return validTarget(undefined); } });
  const [all, setAll] = useState<Partial<Record<Stage, boolean>>>({});
  const [scoring, setScoring] = useState<string | null>(null); // key of the package card whose scorer is open

  const load = useCallback(() => {
    // Each source fails on its own: the board still shows what it has.
    void Promise.allSettled([getJson<{ shown: PIdea[] }>("/api/ideas"), getJson<{ stories: PStory[] }>("/api/studio/clips/story")]).then(([i, s]) => {
      if (i.status === "fulfilled") setIdeas(i.value.shown ?? []);
      if (s.status === "fulfilled") setStories(s.value.stories ?? []);
      const failed = [i.status === "rejected" && "Idea Radar", s.status === "rejected" && "AI Story"].filter(Boolean).join(" and ");
      setWarn(failed ? `Couldn't load ${failed}.` : "");
    });
  }, []);
  useEffect(() => { if (active) load(); }, [active, load]);

  const now = Date.now(), weekStart = weekStartOf(now);
  const cards = useMemo(() => pipelineCards({ ideas, stories, jobs }, weekStart), [ideas, stories, jobs, weekStart]);
  const byStage = useMemo(() => { const m = new Map<Stage, Card[]>(STAGES.map((s) => [s, []])); cards.forEach((c) => m.get(c.stage)!.push(c)); return m; }, [cards]);
  const week = weekProgress(jobs, now, target);
  const saveTarget = (v: string) => { const t = validTarget(v); setTarget(t); try { localStorage.setItem(TARGET_KEY, String(t)); } catch { /* storage unavailable */ } };
  const open = cards.find((c) => c.key === scoring && c.pack);

  return (
    <div className="space-y-3">
      <section className="card" aria-label="Weekly Shorts target">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="hud-title studio-title !text-[0.7rem]">THIS WEEK</h3>
          <div className="flex items-center gap-2 text-[11px]">
            <label className="muted flex items-center gap-1">Target
              <input type="number" min={1} max={50} className="field num w-14 !px-1.5 !py-0.5 !text-xs" value={target} onChange={(e) => saveTarget(e.target.value)} aria-label="Weekly Shorts target" />
            </label>
            <button className="chip" onClick={load} aria-label="Refresh ideas and stories">↻</button>
          </div>
        </div>
        <div role="progressbar" aria-label="Shorts booked this week" aria-valuemin={0} aria-valuemax={week.target} aria-valuenow={Math.min(week.booked, week.target)}
          aria-valuetext={`${week.booked} of ${week.target} Shorts booked this week`} className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,214,224,0.08)" }}>
          <div className="h-full rounded-full" style={{ width: `${week.pct}%`, background: "linear-gradient(90deg, #800f2f, #ff2e63)", transition: reduced ? "none" : "width 0.4s" }} />
        </div>
        <p className="mt-1 text-xs"><b className="num">{week.booked}/{week.target}</b> booked Mon–Sun
          <span className="muted"> · {week.left ? `${week.left} to go` : "target met"} · {week.ready} in review/approved{week.behind ? ` · behind pace (${week.expected} by today)` : ""}</span>
        </p>
        {warn && <p className="error mt-1 text-[11px]" role="alert">{warn}</p>}
      </section>

      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-3 @5xl:grid-cols-6" aria-label="Shorts pipeline">
        {STAGES.map((stage) => {
          const list = byStage.get(stage)!, shown = all[stage] ? list : list.slice(0, PER_STAGE), id = `sb-${stage}`;
          return (
            <section key={stage} className="min-w-0 rounded-xl border border-white/10 p-1.5" aria-labelledby={id}>
              <h4 id={id} className="muted mb-1 flex justify-between text-[10px] font-semibold uppercase tracking-widest"><span className="truncate">{LABEL[stage]}</span><span className="num">{list.length}</span></h4>
              {!list.length && <p className="muted text-[11px]">—</p>}
              <ul className="space-y-1">
                {shown.map((c) => (
                  <li key={c.key} className="rounded-lg border border-white/10 hover:bg-white/5" style={c.warn ? { borderColor: "#fb718588" } : undefined}>
                    <button className="block w-full p-1.5 text-left text-[11px] leading-snug" onClick={() => onOpen(c.open)} aria-label={`${LABEL[stage]}: ${c.title}. ${c.note}. Open`}>
                      <span className="line-clamp-2 break-words">{c.title}</span>
                      <span className="muted block truncate text-[10px]">{c.stage === "scheduled" && c.at ? `${day.format(c.at)} · ` : ""}{c.note}</span>
                    </button>
                    {c.pack && <button className="chip mx-1.5 mb-1.5 !px-1.5 !py-0 !text-[10px]" aria-expanded={scoring === c.key} aria-controls="sb-scorer"
                      onClick={() => setScoring((k) => (k === c.key ? null : c.key))} aria-label={`Score titles for ${c.title}`}>⚖ Score titles</button>}
                  </li>
                ))}
              </ul>
              {list.length > PER_STAGE && <button className="chip mt-1 !px-1.5 !py-0 !text-[10px]" aria-expanded={!!all[stage]} onClick={() => setAll((a) => ({ ...a, [stage]: !a[stage] }))}>
                {all[stage] ? "Show fewer" : `+${list.length - PER_STAGE} more`}</button>}
            </section>
          );
        })}
      </div>

      {open?.pack && <PackScorer key={open.key} card={open} onClose={() => setScoring(null)} onPick={(t) => onPickTitle(open.pack!.job, open.pack!.clip, t)} onMore={() => onMoreTitles(open.pack!.job, open.pack!.clip)} onOpenClip={() => onOpen(open.open)} />}
    </div>
  );
}

/** Thumbnail + title A/B: 2–5 titles ranked by packaging-pure against the owner's own CTR history (or its priors). */
function PackScorer({ card, onClose, onPick, onMore, onOpenClip }: { card: Card; onClose: () => void; onPick: (title: string) => Promise<boolean>; onMore: () => Promise<boolean>; onOpenClip: () => void }) {
  const [titles, setTitles] = useState(() => card.pack!.titles.length >= 2 ? card.pack!.titles : [...card.pack!.titles, ""]);
  const [out, setOut] = useState<Scored | null>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [refill, setRefill] = useState(false);
  const latest = card.pack!.titles.join("\n");
  useEffect(() => { if (refill) { setTitles(latest.split("\n")); setOut(null); setRefill(false); } }, [refill, latest]);
  const clean = titles.map((t) => t.trim()).filter(Boolean);

  async function score() {
    setBusy("score"); setErr("");
    try { setOut(await getJson<Scored>("/api/studio/packaging", { titles: clean, isShort: true })); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  async function run(name: string, fn: () => Promise<boolean>, after?: () => void) {
    setBusy(name);
    setErr("");
    try { if (await fn()) after?.(); else setErr("That didn't go through: the clip card shows why."); } finally { setBusy(""); }
  }
  const head = out && (!out.connected ? <>Connect YouTube for scores from your own CTR. <a className="underline" href="/api/studio/oauth/start">Connect</a> · showing starting priors.</>
    : out.reason ? <>{out.message ?? "YouTube Analytics didn't answer"}: showing starting priors.</>
    : out.mode === "prior" ? <>Only {out.samples} Short{out.samples === 1 ? "" : "s"} with impression data (8 needed): starting priors nudged toward your average.</>
    : <>Fitted on your last {out.samples} Shorts&apos; CTR.</>);

  return (
    <section id="sb-scorer" className="card" aria-label={`Title A/B for ${card.title}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="hud-title studio-title truncate !text-[0.7rem]">TITLE A/B · {card.title}</h3>
        <button className="chip" onClick={onClose} aria-label="Close the title scorer">×</button>
      </div>
      <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (clean.length >= 2) void score(); }}>
        {titles.map((t, i) => (
          <div key={i} className="flex gap-1">
            <input className="field min-w-0 flex-1 !px-2 !py-1 !text-xs" value={t} maxLength={100} onChange={(e) => setTitles(titles.map((x, k) => (k === i ? e.target.value : x)))} aria-label={`Title option ${i + 1}`} />
            {titles.length > 2 && <button type="button" className="chip !px-2" onClick={() => setTitles(titles.filter((_, k) => k !== i))} aria-label={`Remove title option ${i + 1}`}>−</button>}
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {titles.length < 5 && <button type="button" className="chip" onClick={() => setTitles([...titles, ""])}>+ Title</button>}
          <button type="button" className="chip" disabled={!!busy} onClick={() => void run("more", onMore, () => setRefill(true))}>{busy === "more" ? "Writing…" : "✨ Generate titles"}</button>
          <button type="button" className="chip" onClick={onOpenClip}>Thumbnails + Hook Lab on the clip card →</button>
          <button type="submit" className="btn ml-auto !px-3 !py-1 !text-xs" disabled={!!busy || clean.length < 2}>{busy === "score" ? "Scoring…" : "⚖ Score"}</button>
        </div>
      </form>
      {err && <p className="error mt-1 text-xs" role="alert">{err}</p>}
      {out && (
        <div className="mt-2" aria-live="polite">
          <p className="muted text-[11px]">{head}</p>
          <ol className="mt-1 space-y-1.5">
            {out.ranked.map((r) => (
              <li key={r.title} className="rounded-lg border border-white/10 p-1.5 text-xs">
                <div className="flex items-start gap-2">
                  <span className="num muted">#{r.rank}</span>
                  <span className="min-w-0 flex-1 break-words">{r.title}</span>
                  <span className="num shrink-0" title="Predicted CTR (approximate 95% range)">{pct(r.predictedCtr)} <span className="muted">{pct(r.interval.low)}–{pct(r.interval.high)}</span></span>
                </div>
                <ul className="muted mt-0.5 text-[10px] leading-snug">{r.reasons.slice(0, 2).map((x) => <li key={x}>{x}</li>)}</ul>
                <button className="chip mt-1 !px-1.5 !py-0 !text-[10px]" disabled={!!busy} onClick={() => void run(`pick:${r.title}`, () => onPick(r.title))} aria-label={`Use title: ${r.title}`}>
                  {busy === `pick:${r.title}` ? "Saving…" : "Use this title"}</button>
              </li>
            ))}
          </ol>
          <p className="muted mt-1 text-[10px]">An estimate from your own history, not a guarantee.</p>
        </div>
      )}
    </section>
  );
}
