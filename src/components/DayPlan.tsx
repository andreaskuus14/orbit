"use client";
// "Plan my day" card inside the morning brief: today's time-blocked proposal (dayplan-pure), drag flexible tasks to reorder, Accept makes it
// today's list (tick done; the evening review reports done/missed). Plus the commitment inbox: inferred items wait for his Confirm.
import { useEffect, useState } from "react";
import { hhmm, todayList, type Commitment, type DayPlan as Plan } from "@/lib/dayplan-pure";
import { api } from "./AgentMission";
import { useT } from "./i18n";

type Got = { plan: Plan; commitments: Commitment[] };
const post = (body: object) => api<{ result: unknown }>("/api/dayplan", { method: "POST", body: JSON.stringify({ ...body, from: "plan" }) });

export function DayPlan({ onOpen }: { onOpen: (open: unknown) => void }) {
  const { t } = useT();
  const [g, setG] = useState<Got | null>(null);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const load = (fresh = false) => api<Got>(`/api/dayplan${fresh ? "?fresh=1" : ""}`).then(setG, (e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  const run = async (body: object) => { setErr(""); try { await post(body); await load(); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't do that"); } };

  if (!g) return <p className="muted text-sm">{err || "Planning your day…"}</p>;
  const p = g.plan, accepted = !!p.accepted, list = accepted ? todayList(p) : p.blocks;
  return (
    <div className="mt-3 grid gap-2" aria-live="polite">
      {err && <p className="error text-sm" role="alert">{err}</p>}
      <ul className="grid gap-1">
        {list.map((b) => (
          <li key={b.id} className="mb-item" draggable={!accepted && b.flexible}
            onDragStart={() => setDrag(b.id)} onDragOver={(e) => { if (drag && b.flexible) e.preventDefault(); }}
            onDrop={() => { if (drag && drag !== b.id) void run({ move: drag, before: b.id }); setDrag(null); }}>
            <span className="num muted text-xs">{hhmm(b.start)}–{hhmm(b.end)}</span>
            <span className="min-w-0 flex-1">
              <b className={`block truncate ${b.done ? "muted line-through" : ""}`}>{b.title}</b>
              <span className="muted block text-xs">{b.flexible ? "flexible · drag to reorder" : "fixed"} · {b.source.open ? <button className="link" onClick={() => onOpen(b.source.open)}>{b.source.label}</button> : b.source.label}</span>
            </span>
            {accepted && <label className="text-xs"><input type="checkbox" checked={!!b.done} onChange={(e) => void run({ done: b.id, value: e.target.checked })} /> done</label>}
          </li>
        ))}
      </ul>
      {p.load?.overload && <p className="text-xs" role="status">{t("dayplan.overload", { demand: p.load.demandMin, cap: p.load.capMin, free: p.load.freeMin })}</p>}
      {p.carried?.length ? <p className="muted text-xs">{t("dayplan.carried", { list: p.carried.join(", ") })}</p> : null}
      {p.unplaced.some((u) => u.why === "cap") && <p className="muted text-xs">{t("dayplan.capped", { cap: p.load?.capMin ?? 0, list: p.unplaced.filter((u) => u.why === "cap").map((u) => u.title).join(", ") })}</p>}
      {p.unplaced.some((u) => u.why !== "cap") && <p className="muted text-xs">Didn&apos;t fit today: {p.unplaced.filter((u) => u.why !== "cap").map((u) => u.title).join(", ")}</p>}
      <div className="flex gap-1">
        {!accepted && <button className="btn" onClick={() => void run({ accept: true })}>Accept as today&apos;s list</button>}
        <button className="chip" onClick={() => void load(true)}>Re-plan</button>
      </div>
      <h3 className="hud-title mt-2 text-xs">COMMITMENT INBOX</h3>
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void run({ capture: note }).then(() => setNote("")); }}>
        <input className="field flex-1" value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} placeholder="Paste a message or note: “I'll send it by Friday”" aria-label="Capture commitments" />
        <button className="chip" type="submit">Find</button>
      </form>
      <ul className="grid gap-1">
        {g.commitments.map((c) => (
          <li key={c.id} className="mb-item text-sm">
            <span className="min-w-0 flex-1">{c.owner === "them" ? "They: " : ""}{c.text}{c.due ? ` · due ${c.due}` : ""}{c.missing.length ? <span className="muted"> · missing {c.missing.join(", ")}</span> : null}</span>
            {c.status === "awaiting" ? <span className="flex gap-1"><span className="muted text-xs">awaiting confirmation</span>
              <button className="chip" onClick={() => void run({ commitment: c.id, ok: true })}>Confirm</button>
              <button className="chip" onClick={() => void run({ commitment: c.id, ok: false })}>Dismiss</button></span>
              : <span className="muted text-xs">confirmed</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
