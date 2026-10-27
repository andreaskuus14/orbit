"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./AgentMission";
import { useWorldPaused } from "./world-paused";
import { EVENT_RUNS_PER_DAY, type ParsedRule, type Rule } from "@/lib/rules-pure";

// Agents → Rules (roadmap 8.4): write a rule in plain words, read back what ORBIT understood, confirm. Pause is one tap.
type Shown = { when: string; what: string };
type Row = Rule & Shown & { next: string | null; task: { id: string; status: string; error: string | null } | null; skippedToday: number };
const EXAMPLES = ["Prepare my weekly project review on Sunday", "Every weekday 7:30 check deals", "When a client replies, draft an answer"];
const at = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Card({ p }: { p: ParsedRule & Shown }) {
  return (
    <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-xs" style={{ gridTemplateColumns: "auto 1fr" }}>
      <dt className="muted">When</dt><dd>{p.when}</dd>
      <dt className="muted">Does</dt><dd>{p.what}</dd>
      <dt className="muted">Scope</dt><dd>{p.scope}</dd>
      <dt className="muted">Allowed</dt><dd>{p.permissions.join(" · ")}</dd>
    </dl>
  );
}

export function RulesView({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const [list, setList] = useState<Row[]>([]);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<(ParsedRule & Shown) | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [err, setErr] = useState("");
  const load = useCallback(() => api<{ rules: Row[] }>("/api/rules").then((r) => setList(r.rules)).catch((e) => setErr(e.message)), []);
  const paused = useWorldPaused();
  useEffect(() => { if (paused) return; void load(); const h = setInterval(() => void load(), 10_000); return () => clearInterval(h); }, [load, paused]);

  async function post(body: object, after?: () => void) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setErr("");
    try {
      const r = await api<{ rules?: Row[]; parsed?: ParsedRule & Shown }>("/api/rules", { method: "POST", body: JSON.stringify(body) });
      if (r.parsed) setPreview(r.parsed);
      if (r.rules) setList(r.rules);
      after?.();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not update"); }
    finally { locked.current = false; setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <form className="space-y-2" aria-label="New standing rule" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void post({ action: "parse", text }); }}>
        <input className="field w-full" value={text} maxLength={500} disabled={busy} placeholder="e.g. Every weekday 7:30 check deals"
          aria-label="Rule in your own words" onChange={(e) => { setText(e.target.value); setPreview(null); }} />
        <div className="flex flex-wrap gap-1.5">
          <button className="btn" disabled={busy || !text.trim()}>Read it back</button>
          {EXAMPLES.map((x) => <button key={x} type="button" className="chip" disabled={busy} onClick={() => { setText(x); setPreview(null); }}>{x}</button>)}
        </div>
      </form>
      {preview && (
        <div className="card text-sm" style={{ borderColor: "var(--cyan)" }}>
          <b>{preview.name}</b>
          <Card p={preview} />
          <div className="mt-2 flex gap-2">
            <button className="btn" disabled={busy} onClick={() => post({ action: "add", text }, () => { setText(""); setPreview(null); })}>Confirm rule</button>
            <button className="chip" disabled={busy} onClick={() => setPreview(null)}>Not right</button>
          </div>
          <p className="muted mt-1 text-xs">Not right? Reword it and read it back again. Nothing runs until you confirm.</p>
        </div>
      )}
      <ul className="space-y-2">
        {list.map((r) => (
          <li key={r.id} className="card text-sm" style={r.status === "proposed" ? { borderColor: "#fbbf24" } : r.last && !r.last.ok ? { borderColor: "#f43f5e" } : undefined}>
            <div className="flex items-center justify-between gap-2">
              <b className={r.status === "paused" ? "muted" : ""}>{r.name}</b>
              <span className="flex gap-1.5">
                {r.status === "active" && <button className="chip" disabled={busy} onClick={() => post({ action: "run", id: r.id })}>Run now</button>}
                {r.status === "proposed" && <button className="chip" disabled={busy} onClick={() => post({ action: "confirm", id: r.id })}>Confirm</button>}
                {r.status !== "proposed" && <button className="chip" disabled={busy} aria-pressed={r.status === "paused"} onClick={() => post({ action: r.status === "active" ? "pause" : "resume", id: r.id })}>{r.status === "active" ? "Pause" : "Resume"}</button>}
                <button className="chip" disabled={busy} aria-label={`Delete ${r.name}`} onClick={() => { if (confirm(`Delete "${r.name}"?`)) void post({ action: "delete", id: r.id }); }}>Delete</button>
              </span>
            </div>
            <Card p={r} />
            <div className="muted mt-1 text-xs">
              {r.status === "proposed" ? "Proposed by CORE: not active until you confirm" : r.status === "paused" ? "Paused" : r.next ? `Next: ${at(r.next)}` : "Active"}
              {" · "}“{r.text}”
              {r.skippedToday > 0 && ` · ${r.skippedToday} event${r.skippedToday === 1 ? "" : "s"} skipped today (limit ${EVENT_RUNS_PER_DAY} runs a day)`}
            </div>
            {r.last && (
              <div className="mt-1 text-xs">
                Last result ({at(r.last.at)}):{" "}
                {r.last.taskId
                  ? <button className="link" onClick={() => onOpenTask(r.last!.taskId!)}>{r.task ? `agent task ${r.task.status.replace("_", " ")}` : "agent task"}</button>
                  : <span className={r.last.ok ? "" : "error"}>{r.last.text.split("\n")[0].slice(0, 200)}</span>}
                {r.task?.error && <span className="error"> · {r.task.error.slice(0, 120)}</span>}
              </div>
            )}
          </li>
        ))}
        {!list.length && <li className="muted text-sm">No standing rules yet. Write one above, or tell CORE (“every Sunday, prepare my weekly review”).</li>}
      </ul>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
