"use client";
// Why? / Remember / Correct / Forget on a memory (POST /api/memories/[id]/control; logic in provenance-pure.ts).
import { useState } from "react";

type Source = { id: string; title: string; source: string; when: string; confirmation: string; link: string };
type Props = { id: string; content: string; confirmation?: string | null; recheckAt?: string | null; onDone: (gone: boolean) => void; onOpen: (id: string) => void };

async function post<T>(id: string, body: object): Promise<T> {
  const r = await fetch(`/api/memories/${id}/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Failed");
  return j as T;
}

export default function MemoryControls({ id, content, confirmation, recheckAt, onDone, onOpen }: Props) {
  const [why, setWhy] = useState<Source[] | null>(null);
  const [msg, setMsg] = useState("");
  const run = (f: () => Promise<string>) => f().then(setMsg, (e: Error) => setMsg(e.message));
  return (
    <div className="space-y-2" aria-live="polite">
      <p className="muted text-xs">{confirmation === "suggested" ? "Suggested by ORBIT, not confirmed" : "Confirmed"}{recheckAt && ` · recheck ${new Date(recheckAt).toLocaleDateString()}`}</p>
      <div className="flex flex-wrap gap-2">
        <button className="chip" onClick={() => run(async () => { setWhy((await post<{ sources: Source[] }>(id, { action: "why" })).sources); return ""; })}>Why?</button>
        {confirmation === "suggested" && <button className="chip" onClick={() => run(async () => { await post(id, { action: "confirm" }); onDone(false); return "Remembered as confirmed."; })}>Remember</button>}
        <button className="chip" onClick={() => run(async () => { const r = await post<{ summariesUpdated: number }>(id, { action: "correct", content }); onDone(false); return `Corrected${r.summariesUpdated ? `; ${r.summariesUpdated} summaries updated` : ""}.`; })}>Correct</button>
        <button className="chip" onClick={() => { if (confirm("Forget this memory? Summaries that quote it are updated too. Only its id stays in the activity log.")) run(async () => { await post(id, { action: "forget" }); onDone(true); return "Forgotten."; }); }}>Forget</button>
      </div>
      {why && (
        <ul className="text-xs space-y-1">
          {why.map((s) => <li key={s.id}><button className="link" onClick={() => onOpen(s.id)}>{s.title}</button> <span className="muted">· {s.source} · {new Date(s.when).toLocaleString()} · {s.confirmation}</span></li>)}
          {!why.length && <li className="muted">No recorded source.</li>}
        </ul>
      )}
      {msg && <p className="muted text-xs">{msg}</p>}
    </div>
  );
}
