"use client";
import { useEffect, useState } from "react";
import type { Insights } from "@/lib/clips/learn-pure";
import type { Lesson, Playbook } from "@/lib/clips/study-pure";
import StudyButton from "./StudyButton";

type Data = Insights & { study?: { playbook: Playbook; recent: Lesson[]; busy: string | null; min: number } | null };

// "What ORBIT learned" (Clip Factory): top clips by performance, patterns and the owner's reject reasons. Data: /api/studio/clips/learn.

const when = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never"; };
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function LearnedCard({ defaultOpen }: { defaultOpen?: boolean }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/studio/clips/learn", { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setD(j as Data);
    }).catch((e: Error) => setErr(e.message));
  }, []);
  const none = <p className="muted">Not enough data yet.</p>;
  const pb = d?.study?.playbook;
  const row = (label: string, items: string[]) => <li><span className="muted">{label}:</span> {items.join(", ")}</li>;
  return (
    <details className="card text-xs" aria-label="What ORBIT learned" open={defaultOpen}>
      <summary className="hud-title studio-title cursor-pointer !text-[0.7rem]">WHAT ORBIT LEARNED <span className="muted normal-case">· updated {when(d?.checkedAt)}</span></summary>
      <div className="mt-2 space-y-2">
        {err && <p className="error" role="alert">{err}</p>}
        {!d && !err && <div className="space-y-2" role="status" aria-label="Loading"><span className="sr-only">Loading…</span>{[0, 1, 2].map((k) => <div key={k} aria-hidden className="h-10 animate-pulse rounded-lg bg-white/5" />)}</div>}
        {d && (<>
          <div>
            <h4 className="muted mb-1">Top clips ({d.scored} of {d.published} published have 72 h stats)</h4>
            {d.top.length ? <ol className="list-decimal pl-4">{d.top.map((t) => (
              <li key={t.videoId}><a href={`https://youtube.com/shorts/${t.videoId}`} target="_blank" rel="noreferrer" className="underline">{t.title}</a>{" "}
                <span className="muted">{t.views72.toLocaleString()} views at 72 h · {t.score}× median{t.avgViewPct ? ` · ${t.avgViewPct}% viewed` : ""}</span></li>))}</ol> : none}
          </div>
          <div>
            <h4 className="muted mb-1">Winners vs flops ({d.judged ?? 0} Shorts with 24 h/72 h stats, vs your median)</h4>
            {d.winners?.length || d.flops?.length ? <ul className="space-y-1">
              {([["🏆 Winners", d.winners ?? [], d.why?.winners], ["📉 Flops", d.flops ?? [], d.why?.flops]] as const).map(([label, list, why]) => !!list.length && (
                <li key={label}><span className="muted">{label}:</span>{why && <span> {why}</span>}
                  <ol className="list-decimal pl-4">{list.map((j) => (
                    <li key={j.videoId}><a href={`https://youtube.com/shorts/${j.videoId}`} target="_blank" rel="noreferrer" className="underline">{j.title}</a>{" "}
                      <span className="muted">{j.views.toLocaleString()} views at {j.snap} · {j.perf}× median · {(j.likeRate * 100).toFixed(1)}% likes · {(j.commentRate * 100).toFixed(1)}% comments</span>
                      {j.verdict === "winner" && <StudyButton id={j.videoId} title={j.title} channel="your channel" views={j.views} source="own" />}</li>))}</ol>
                </li>))}
              {!!d.editHints?.length && row("Editing", d.editHints)}
            </ul> : none}
          </div>
          <div>
            <h4 className="muted mb-1">📚 Viral playbook ({pb?.n ?? 0} Shorts studied{pb && d?.study && pb.n < d.study.min ? ` · edits adapt from ${d.study.min}` : pb ? " · tuning your edits" : ""})</h4>
            {pb?.n ? <ul>
              {row("Typical", [`${pb.lengthSec} s long`, `${pb.shotSec} s per shot`, `payoff at ~${Math.round(pb.payoffAt * 100)}%`])}
              {!!pb.hooks.length && row("Hooks", pb.hooks.slice(0, 3).map((c) => `${c.label} (${c.n})`))}
              {!!pb.effects.length && row("Effects in most", pb.effects.slice(0, 5).map((c) => `${c.label} (${c.n})`))}
              {!!pb.thumbs.length && row("Thumbnails", pb.thumbs.slice(0, 2).map((c) => `${c.label} (${c.n})`))}
              {!!pb.titlePatterns.length && row("Title formulas", pb.titlePatterns.map((c) => `${c.label} (${c.n})`))}
              {!!pb.lessons.length && row("Lessons", pb.lessons.slice(0, 3))}
            </ul> : <p className="muted">Nothing studied yet: press 📚 Study on a Short blowing up in your niche (Trend Radar → Rising) or on one of your winners.</p>}
          </div>
          <div>
            <h4 className="muted mb-1">Channel patterns</h4>
            {d.over.length || d.under.length ? <ul>
              {!!d.over.length && row("Over-perform", d.over.slice(0, 4).map((b) => `${b.text} (${b.value}×, ${b.n})`))}
              {!!d.under.length && row("Under-perform", d.under.slice(0, 4).map((b) => `${b.text} (${b.value}×, ${b.n})`))}
            </ul> : none}
          </div>
          <div>
            <h4 className="muted mb-1">Your reviews ({d.decided} decided)</h4>
            {d.rejects.length || d.liked.length || d.disliked.length || d.versions.length ? <ul>
              {!!d.rejects.length && row("Rejected for", d.rejects.map((r) => `${r.reason} (${r.n})`))}
              {!!d.liked.length && row("Approve more", d.liked.slice(0, 4).map((b) => `${b.text} (${pct(b.value)} of ${b.n})`))}
              {!!d.disliked.length && row("Approve less", d.disliked.slice(0, 4).map((b) => `${b.text} (${pct(b.value)} of ${b.n})`))}
              {!!d.versions.length && row("Re-rendered with", d.versions.map((v) => `${v.change} (${v.n})`))}
            </ul> : none}
          </div>
          {d.warnings.map((w) => <p key={w} className="muted">⚠ {w}</p>)}
        </>)}
      </div>
    </details>
  );
}
