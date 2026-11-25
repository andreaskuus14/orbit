"use client";
import { useEffect, useState } from "react";
import type { Insights } from "@/lib/clips/learn-pure";
import type { Lesson, Playbook } from "@/lib/clips/study-pure";
import type { ModelStatus } from "@/lib/clips/score";
import StudyButton from "./StudyButton";
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n-core-pure";

type Data = Insights & { study?: { playbook: Playbook; recent: Lesson[]; busy: string | null; min: number; rules?: string[] } | null; model?: ModelStatus | null };

const SIGNAL = (k: ModelStatus["top"][number]["key"]) => `lc.sig.${k}` as Key;

/** Virality model status + how the score works. */
function ScoreModel({ m }: { m: ModelStatus }) {
  const { t } = useT();
  const top = m.top.slice(0, 5), max = Math.max(...top.map((x) => Math.abs(x.w)), 0.01);
  return (
    <div>
      <h4 className="muted mb-1">🎯 {t("lc.virality")} · {m.learned ? t("lc.learnedFrom", { n: m.n, conf: m.conf }) : t("lc.learning", { n: m.n, min: m.min })}</h4>
      {!m.learned && (
        <div className="mb-1.5 h-1 overflow-hidden rounded-full" style={{ background: "rgba(255,214,224,0.08)" }} role="progressbar" aria-label={t("lc.learnedBar")}
          aria-valuemin={0} aria-valuemax={m.min} aria-valuenow={m.n}>
          <div className="h-full rounded-full" style={{ width: `${(m.n / m.min) * 100}%`, background: "linear-gradient(90deg,#a855f7,#ff2e63,#ffb347)" }} />
        </div>
      )}
      <ul className="space-y-1" aria-label={m.learned ? t("lc.predicts") : t("lc.startWeights")}>
        {top.map((x) => (
          <li key={x.key} className="score-factor">
            <span>{t(SIGNAL(x.key))}{x.w < 0 ? ` ${t("lc.hurts")}` : ""}</span>
            <span className="num muted">{m.learned && Math.abs(x.w - x.prior) >= 0.1 ? (x.w > x.prior ? `↑ ${t("lc.learnedTag")}` : `↓ ${t("lc.learnedTag")}`) : ""}</span>
            <span className="score-bar" aria-hidden><i style={{ width: `${(Math.abs(x.w) / max) * 100}%`, background: x.w >= 0 ? "linear-gradient(90deg,#ff2e63,#ffb347)" : "linear-gradient(90deg,#a855f7,#c084fc)" }} /></span>
          </li>
        ))}
      </ul>
      <details className="score-why mt-1.5">
        <summary>{t("lc.how")}</summary>
        <div className="muted mt-1 space-y-1 leading-snug">
          <p>{t("lc.how1")}</p>
          <p>{t("lc.how2")}</p>
          <p>{t("lc.how3", { n: m.min })}</p>
        </div>
      </details>
    </div>
  );
}

// "What ORBIT learned" (Clip Factory): top clips by performance, patterns and the owner's reject reasons. Data: /api/studio/clips/learn.

const when = (iso: string | undefined, never: string) => { const ms = iso ? Date.parse(iso) : NaN; return Number.isFinite(ms) ? new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : never; };
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function LearnedCard({ defaultOpen }: { defaultOpen?: boolean }) {
  const { t } = useT();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/studio/clips/learn", { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setD(j as Data);
    }).catch((e: Error) => setErr(e.message));
  }, []);
  const none = <p className="muted">{t("lc.notEnough")}</p>;
  const pb = d?.study?.playbook;
  const row = (label: string, items: string[]) => <li><span className="muted">{label}:</span> {items.join(", ")}</li>;
  return (
    <details className="card text-xs" aria-label={t("lc.title")} open={defaultOpen}>
      <summary className="hud-title studio-title cursor-pointer !text-[0.7rem]">{t("lc.titleHead")} <span className="muted normal-case">· {t("lc.updated", { at: when(d?.checkedAt, t("lc.never")) })}</span></summary>
      <div className="mt-2 space-y-2">
        {err && <p className="error" role="alert">{err}</p>}
        {!d && !err && <div className="space-y-2" role="status" aria-label={t("common.loading")}><span className="sr-only">{t("common.loading")}</span>{[0, 1, 2].map((k) => <div key={k} aria-hidden className="h-10 animate-pulse rounded-lg bg-white/5" />)}</div>}
        {d && (<>
          <div>
            <h4 className="muted mb-1">{t("lc.top", { n: d.scored, of: d.published })}</h4>
            {d.top.length ? <ol className="list-decimal pl-4">{d.top.map((x) => (
              <li key={x.videoId}><a href={`https://youtube.com/shorts/${x.videoId}`} target="_blank" rel="noreferrer" className="underline">{x.title}</a>{" "}
                <span className="muted">{t("lc.topLine", { v: x.views72.toLocaleString(), s: x.score })}{x.avgViewPct ? ` · ${t("lc.viewed", { n: x.avgViewPct })}` : ""}</span></li>))}</ol> : none}
          </div>
          <div>
            <h4 className="muted mb-1">{t("lc.winFlop", { n: d.judged ?? 0 })}</h4>
            {d.winners?.length || d.flops?.length ? <ul className="space-y-1">
              {([[`🏆 ${t("lc.winners")}`, d.winners ?? [], d.why?.winners], [`📉 ${t("lc.flops")}`, d.flops ?? [], d.why?.flops]] as const).map(([label, list, why]) => !!list.length && (
                <li key={label}><span className="muted">{label}:</span>{why && <span> {why}</span>}
                  <ol className="list-decimal pl-4">{list.map((j) => (
                    <li key={j.videoId}><a href={`https://youtube.com/shorts/${j.videoId}`} target="_blank" rel="noreferrer" className="underline">{j.title}</a>{" "}
                      <span className="muted">{t("lc.judgeLine", { v: j.views.toLocaleString(), snap: j.snap, perf: j.perf, likes: (j.likeRate * 100).toFixed(1), comments: (j.commentRate * 100).toFixed(1) })}</span>
                      {j.verdict === "winner" && <StudyButton id={j.videoId} title={j.title} channel={t("lc.yourChannel")} views={j.views} source="own" />}</li>))}</ol>
                </li>))}
              {!!d.editHints?.length && row(t("lc.editing"), d.editHints)}
            </ul> : none}
          </div>
          <div>
            <h4 className="muted mb-1">📚 {t("lc.playbook", { n: pb?.n ?? 0 })}{pb && d?.study && pb.n < d.study.min ? ` · ${t("lc.adaptFrom", { n: d.study.min })}` : pb ? ` · ${t("lc.tuning")}` : ""})</h4>
            {pb?.n ? <ul>
              {row(t("lc.typical"), [t("lc.long", { n: pb.lengthSec }), t("lc.perShot", { n: pb.shotSec }), t("lc.payoff", { n: Math.round(pb.payoffAt * 100) })])}
              {!!pb.hooks.length && row(t("lc.hooks"), pb.hooks.slice(0, 3).map((c) => `${c.label} (${c.n})`))}
              {!!pb.effects.length && row(t("lc.effects"), pb.effects.slice(0, 5).map((c) => `${c.label} (${c.n})`))}
              {!!pb.thumbs.length && row(t("lc.thumbs"), pb.thumbs.slice(0, 2).map((c) => `${c.label} (${c.n})`))}
              {!!pb.titlePatterns.length && row(t("lc.titles"), pb.titlePatterns.map((c) => `${c.label} (${c.n})`))}
              {!!pb.lessons.length && row(t("lc.lessons"), pb.lessons.slice(0, 3))}
            </ul> : <p className="muted">{t("lc.nothingStudied")}</p>}
            {!!d.study?.rules?.length && <ul>{row(t("lc.rules"), d.study.rules)}</ul>}
          </div>
          {d.model && <ScoreModel m={d.model} />}
          <div>
            <h4 className="muted mb-1">{t("lc.patterns")}</h4>
            {d.over.length || d.under.length ? <ul>
              {!!d.over.length && row(t("lc.over"), d.over.slice(0, 4).map((b) => `${b.text} (${b.value}×, ${b.n})`))}
              {!!d.under.length && row(t("lc.under"), d.under.slice(0, 4).map((b) => `${b.text} (${b.value}×, ${b.n})`))}
            </ul> : none}
          </div>
          <div>
            <h4 className="muted mb-1">{t("lc.reviews", { n: d.decided })}</h4>
            {d.rejects.length || d.liked.length || d.disliked.length || d.versions.length ? <ul>
              {!!d.rejects.length && row(t("lc.rejected"), d.rejects.map((r) => `${r.reason} (${r.n})`))}
              {!!d.liked.length && row(t("lc.approveMore"), d.liked.slice(0, 4).map((b) => `${b.text} (${t("lc.pctOf", { p: pct(b.value), n: b.n })})`))}
              {!!d.disliked.length && row(t("lc.approveLess"), d.disliked.slice(0, 4).map((b) => `${b.text} (${t("lc.pctOf", { p: pct(b.value), n: b.n })})`))}
              {!!d.versions.length && row(t("lc.rerendered"), d.versions.map((v) => `${v.change} (${v.n})`))}
            </ul> : none}
          </div>
          {d.warnings.map((w) => <p key={w} className="muted">⚠ {w}</p>)}
        </>)}
      </div>
    </details>
  );
}
