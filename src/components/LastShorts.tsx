"use client";
import { useEffect, useState } from "react";
import { useWorldPaused } from "./world-paused";
import { useT } from "./i18n";
import type { ShortResult } from "@/lib/clips/learn-pure";
import type { PostMortemView } from "@/lib/clips/postmortem-pure";

/** Retention post-mortem line + its ONE proposed rule (added to the Study playbook only on his click). */
function PostMortemLine({ pm, videoId, onRule }: { pm?: PostMortemView | null; videoId: string; onRule?: (videoId: string, action: "accept" | "dismiss") => void }) {
  const { t } = useT();
  const p = pm?.items.find((i) => i.videoId === videoId);
  if (!p) return null;
  return <div className="mt-1 space-y-1">
    <p className="muted">{p.line}</p>
    {p.rule && p.ruleStatus === "proposed" && <>
      <p>{t("sx.ls.rule", { rule: p.rule })}</p>
      <p className="flex flex-wrap gap-1"><button className="chip" disabled={!onRule} onClick={() => onRule?.(videoId, "accept")}>{t("sx.ls.add")}</button>
        <button className="chip" disabled={!onRule} onClick={() => onRule?.(videoId, "dismiss")}>{t("sx.ls.dismissRule")}</button></p></>}
    {p.ruleStatus === "accepted" && <p className="muted">{t("sx.ls.added")}</p>}
  </div>;
}

export function ShortsStrip({ shorts, onRestore, restoring, pm, onRule }: { shorts: ShortResult[]; onRestore?: (s: ShortResult) => void; restoring?: string;
  pm?: PostMortemView | null; onRule?: (videoId: string, action: "accept" | "dismiss") => void }) {
  const { t } = useT();
  return (
    <section className="st-ls text-xs" aria-labelledby="st-ls-h">
      <h3 id="st-ls-h" className="text-sm font-semibold">{t("sx.ls.title")}</h3>
      <p className="muted mt-1">{t("sx.ls.what")}</p>
      {shorts.length ? <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {shorts.map((s) => <li key={s.videoId} className="card w-48 shrink-0 !p-2.5">
          <a className="line-clamp-2 font-medium hover:underline" href={`https://youtube.com/shorts/${s.videoId}`} target="_blank" rel="noreferrer">{s.title}</a>
          {s.views24 !== undefined && <p className="num mt-1">{t("sx.ls.v24", { n: s.views24.toLocaleString() })}{s.flopped24 ? ` · ${t("sx.ls.flop")}` : ""}</p>}
          {s.views48 !== null ? <p className="num">{t("sx.ls.v48", { n: s.views48.toLocaleString() })}</p> : <p className="muted">{t("sx.ls.pending")}</p>}
          <p className={s.verdict === "worked" ? "ok" : s.verdict === "flopped" ? "error" : "muted"}>
            {s.changePct === null ? t("sx.ls.noBase") : `${t("sx.ls.vs", { arrow: s.changePct > 0 ? "↑" : s.changePct < 0 ? "↓" : "=", pct: Math.abs(s.changePct) })} · ${t(s.verdict === "worked" ? "sx.ls.worked" : s.verdict === "flopped" ? "sx.ls.flopped" : "sx.ls.even")}`}
          </p>
          {s.avgViewPct !== undefined && <p className="muted">{t("sx.ls.avg", { n: s.avgViewPct })}</p>}
          <PostMortemLine pm={pm} videoId={s.videoId} onRule={onRule} />
          {s.retryState && <p className="muted">{s.retryState}</p>}
          {s.retryError && <p className="error">{s.retryError} {s.retryError.includes("Reconnect YouTube") && <a className="underline" href="/api/studio/oauth/start">{t("sx.ls.reconnect")}</a>}</p>}
          {s.canRestore && <button className="chip mt-1" disabled={!onRestore || !!restoring} onClick={() => onRestore?.(s)}>{restoring === s.videoId ? t("sx.ls.restoring") : t("sx.ls.restore")}</button>}
        </li>)}
      </ul> : <p className="muted mt-2">{t("sx.ls.none")}</p>}
      {pm?.status && <p className="muted mt-1">{pm.status}</p>}
      <p className="muted mt-1">{t("sx.ls.note")}</p>
    </section>
  );
}

export default function LastShorts() {
  const [shorts, setShorts] = useState<ShortResult[] | null>(null);
  const [err, setErr] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [restoring, setRestoring] = useState("");
  const [pm, setPm] = useState<PostMortemView | null>(null);
  const rule = async (videoId: string, action: "accept" | "dismiss") => {
    try {
      const r = await fetch("/api/studio/clips/postmortem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId, action }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't save the rule");
      setPm(j);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save the rule"); }
  };
  const restore = async (s: ShortResult) => {
    setRestoring(s.videoId); setErr("");
    try {
      const r = await fetch(`/api/studio/clips/${encodeURIComponent(s.jobId!)}/${encodeURIComponent(s.clipId!)}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId: s.videoId }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't restore the original");
      setRefresh((n) => n + 1);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't restore the original"); }
    finally { setRestoring(""); }
  };
  const paused = useWorldPaused();
  useEffect(() => {
    if (paused) return; // STUDIO kept but hidden: no 15-min poll; returning refreshes
    let active = true;
    const load = async () => {
      try {
        const r = await fetch("/api/studio/analytics?results=1", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Couldn't load Short results");
        if (active) { setShorts(j.shorts); setPm(j.postmortem ?? null); setWarnings(j.warnings ?? []); setErr(""); }
      } catch (e) { if (active) setErr(e instanceof Error ? e.message : "Couldn't load Short results"); }
    };
    void load();
    const timer = setInterval(() => void load(), 15 * 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [refresh, paused]);
  const { t } = useT();
  return <>
    {shorts && <ShortsStrip shorts={shorts} onRestore={(s) => void restore(s)} restoring={restoring} pm={pm} onRule={(v, a) => void rule(v, a)} />}
    {!shorts && !err && <p className="muted text-xs" role="status">{t("sx.ls.loading")}</p>}
    {err && <p className="error text-xs" role="alert">{shorts ? err : t("sx.ls.err")}</p>}
    {!!warnings.length && <p className="muted text-xs">{warnings.join(" · ")}</p>}
  </>;
}
