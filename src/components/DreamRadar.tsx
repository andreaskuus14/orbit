"use client";
// Dream mode's "Connections I found" card (morning briefing) and the Opportunity radar's open windows (home + morning), both on
// the shared ProgressCard. Rules: lib/dream-pure.ts, lib/radar-pure.ts. The radar's button only starts a draft task inside ORBIT.
import { useCallback, useState } from "react";
import { dreamCard, type DreamReport } from "@/lib/dream-pure";
import type { Progress } from "@/lib/progress-pure";
import type { Evidence } from "@/lib/radar-pure";
import { localDay } from "@/lib/morning-pure";
import { ProgressCard, openProgress } from "./ProgressCard";
import { usePoll } from "./use-poll";
import { useT } from "./i18n";

const ICON = { memory: "🧠", chat: "💬", project: "📁", task: "🤖", goal: "🎯", short: "🎬", idea: "💡" } as const;

export function DreamCard({ report, onNav = openProgress }: { report: DreamReport; onNav?: (open: string) => void }) {
  const { t, lang } = useT();
  const [r, setR] = useState(report);
  const [err, setErr] = useState("");
  const card = dreamCard(r, localDay(new Date()), lang);
  if (!card) return null;
  const undo = async () => {
    setErr("");
    const res = await fetch("/api/dream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ undo: true }) }).catch(() => null);
    const j = await res?.json().catch(() => ({}));
    if (!res || (!res.ok && res.status !== 207)) { setErr(j?.errors?.[0] || j?.error || t("dream.undoFailed")); return; }
    setR({ ...r, undone: new Date().toISOString() });
    if (j?.errors?.length) setErr(j.errors[0]);
  };
  return (
    <ProgressCard p={card} onAction={() => void undo()}>
      <ol className="dream-list grid gap-1.5 text-sm">
        {r.connections.map((c, k) => (
          <li key={k}>
            <p>{c.text}</p>
            <span className="flex flex-wrap gap-1">{c.items.map((i) => (
              <button key={i.id} type="button" className="chip text-xs" title={i.title} onClick={() => onNav(i.open)}>{ICON[i.source]} {i.title.slice(0, 40)}</button>))}</span>
          </li>
        ))}
      </ol>
      {err && <p className="error text-xs" role="alert">{err}</p>}
      <p className="muted text-xs">{t("dream.note")}</p>
    </ProgressCard>
  );
}

type Win = { id: string; card: Progress; evidence: Evidence[] };

export function RadarCards({ max = 2, onNav = openProgress }: { max?: number; onNav?: (open: string) => void }) {
  const { t, lang } = useT();
  const [wins, setWins] = useState<Win[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    void fetch(`/api/radar?lang=${lang}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (Array.isArray(j?.windows)) setWins(j.windows); }, () => {});
  }, [lang]);
  usePoll(load, 5 * 60_000);
  const act = async (id: string, what: "draft" | "later") => {
    setBusy(id); setMsg("");
    const r = await fetch("/api/radar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, act: what }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setBusy("");
    if (!r?.ok) { setMsg(j?.error || t("radar.failed")); return; }
    setWins((w) => w.filter((x) => x.id !== id));
    if (j.task) { setMsg(t("radar.started")); onNav(`#o=operations&k=task&id=${encodeURIComponent(j.task)}`); }
    else if (j.open) onNav(j.open);
  };
  if (!wins.length) return msg ? <p className="muted text-xs" role="status">{msg}</p> : null;
  return (
    <div className="grid gap-2" aria-label={t("radar.title")}>
      {wins.slice(0, max).map((w) => (
        <ProgressCard key={w.id} p={busy === w.id ? { ...w.card, action: null } : w.card} onAction={() => void act(w.id, "draft")}>
          <ul className="grid gap-0.5 text-xs">
            {w.evidence.map((e, k) => <li key={k}>{e.url ? <a className="link" href={e.url} target="_blank" rel="noopener noreferrer">{e.title}</a> : <span className="muted">{e.title}</span>}</li>)}
          </ul>
          <button type="button" className="link text-xs" onClick={() => void act(w.id, "later")}>{t("radar.later")}</button>
        </ProgressCard>
      ))}
      {msg && <p className="muted text-xs" role="status">{msg}</p>}
    </div>
  );
}
