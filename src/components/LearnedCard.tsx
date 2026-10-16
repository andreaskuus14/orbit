"use client";
import { useEffect, useState } from "react";
import type { Insights } from "@/lib/clips/learn-pure";

// "What ORBIT learned" (Clip Factory): top clips by performance, patterns and the owner's reject reasons. Data: /api/studio/clips/learn.

const when = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never"; };
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function LearnedCard() {
  const [d, setD] = useState<Insights | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/studio/clips/learn", { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setD(j as Insights);
    }).catch((e: Error) => setErr(e.message));
  }, []);
  const none = <p className="muted">Not enough data yet.</p>;
  const row = (label: string, items: string[]) => <li><span className="muted">{label}:</span> {items.join(", ")}</li>;
  return (
    <details className="card text-xs" aria-label="What ORBIT learned">
      <summary className="hud-title studio-title cursor-pointer !text-[0.7rem]">WHAT ORBIT LEARNED <span className="muted normal-case">· updated {when(d?.checkedAt)}</span></summary>
      <div className="mt-2 space-y-2">
        {err && <p className="error" role="alert">{err}</p>}
        {!d && !err && <p className="muted">Loading…</p>}
        {d && (<>
          <div>
            <h4 className="muted mb-1">Top clips ({d.scored} of {d.published} published have 72 h stats)</h4>
            {d.top.length ? <ol className="list-decimal pl-4">{d.top.map((t) => (
              <li key={t.videoId}><a href={`https://youtube.com/shorts/${t.videoId}`} target="_blank" rel="noreferrer" className="underline">{t.title}</a>{" "}
                <span className="muted">{t.views72.toLocaleString()} views at 72 h · {t.score}× median{t.avgViewPct ? ` · ${t.avgViewPct}% viewed` : ""}</span></li>))}</ol> : none}
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
