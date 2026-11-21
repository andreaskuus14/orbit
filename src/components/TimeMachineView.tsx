"use client";
// OPERATIONS → Time machine: one timeline of everything ORBIT did, scrubbable by day, as the shared progress cards. Each card's one
// button is Undo (or Undo the undo); sends say "Can't be undone: it was sent"; journal shows only "Journal entry · day".
// Data: /api/time-machine (rules: lib/time-machine-pure.ts).
import { useCallback, useEffect, useMemo, useState } from "react";
import { ProgressList } from "./ProgressCard";
import { useT } from "./i18n";
import { entryCard, type Entry } from "@/lib/time-machine-pure";
import type { Progress } from "@/lib/progress-pure";

type Got = { day: string; days: string[]; entries: Entry[] };

export function TimeMachineView({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { t, lang } = useT();
  const [day, setDay] = useState("");
  const [got, setGot] = useState<Got | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (d: string) => {
    try {
      const r = await fetch(`/api/time-machine${d ? `?day=${d}` : ""}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setGot(j); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  useEffect(() => { void load(day); }, [day, load]);

  const days = useMemo(() => [...(got?.days ?? [])].reverse(), [got]); // oldest → newest, for the slider
  const cur = got?.day ?? day;
  const i = days.indexOf(cur);
  const cards = useMemo(() => (got ? got.entries.map((e) => entryCard(e, lang)) : null), [got, lang]);
  const byId = useMemo(() => new Map((got?.entries ?? []).map((e) => [e.id, e])), [got]);

  async function undo(p: Progress) {
    const e = byId.get(p.id);
    if (!e?.undo || busy) return;
    setBusy(true); setNote("");
    try {
      const body = "tm" in e.undo ? { tm: e.undo.tm } : { undo: e.undo.act, area: e.undo.area };
      const r = await fetch("/api/time-machine", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setErr(""); setNote(j.tm ? t("tm.undone") : t("act.undo"));
      await load(cur);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Undo failed"); } finally { setBusy(false); }
  }
  const open = (p: Progress) => { const e = byId.get(p.id); if (e?.link?.task) onOpenTask(e.link.task); };

  const label = cur ? new Date(`${cur}T12:00:00Z`).toLocaleDateString(lang === "et" ? "et-EE" : undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
  return (
    <section className="space-y-3" aria-labelledby="tm-title">
      <div>
        <h3 id="tm-title" className="h3">{t("tm.title")}</h3>
        <p className="muted text-sm">{t("tm.purpose")}</p>
      </div>
      <div role="group" aria-label={t("tm.pick")} className="flex items-center gap-2 text-xs">
        <button className="chip" disabled={i <= 0} onClick={() => setDay(days[i - 1])} aria-label={t("tm.prev")}>←</button>
        <input type="range" min={0} max={Math.max(0, days.length - 1)} step={1} value={Math.max(0, i)} disabled={days.length < 2}
          onChange={(e) => setDay(days[Number(e.target.value)])} aria-label={t("tm.pick")} aria-valuetext={label} className="h-1 min-w-0 flex-1 accent-sky-300" />
        <button className="chip" disabled={i < 0 || i >= days.length - 1} onClick={() => setDay(days[i + 1])} aria-label={t("tm.next")}>→</button>
        <button className="chip" disabled={i === days.length - 1} onClick={() => setDay("")}>{t("tm.today")}</button>
      </div>
      <p className="text-sm tabular-nums" aria-live="polite">{label}</p>
      {err && <p className="error text-sm" role="alert">{err}</p>}
      {note && !err && <p className="muted text-sm" role="status">{note}</p>}
      <ProgressList items={cards} compact={false} empty={t("tm.empty")} onAction={(_, p) => void undo(p)} onOpen={open} />
    </section>
  );
}
