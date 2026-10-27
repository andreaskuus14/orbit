"use client";
import { useState } from "react";
import type { Link, Moment } from "@/lib/chronicle-pure";
import type { Range } from "@/lib/when-pure";
import { OPEN_SOURCE_EVENT } from "@/lib/week-pure";

// MEMORY → Rewind: type a time phrase, see that period's timeline from ORBIT's own records (/api/rewind, when.ts).
export function Rewind({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [out, setOut] = useState<{ range?: Range; days?: { day: string; moments: Moment[] }[]; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault(); if (!q.trim()) return;
    setBusy(true);
    try { setOut(await fetch(`/api/rewind?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" }).then((r) => r.json())); }
    catch (err) { setOut({ error: err instanceof Error ? err.message : "Rewind failed" }); } finally { setBusy(false); }
  }
  const open = (l: Link) => (l.kind === "memory" ? onOpen(l.id) : dispatchEvent(new CustomEvent(OPEN_SOURCE_EVENT, { detail: l })));
  return (
    <div>
      <h3 className="h3">Rewind</h3>
      <form className="my-2 flex gap-2" onSubmit={go}>
        <input className="field flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="in March, last week, between Oct 1 and 15…" aria-label="Time to rewind to" maxLength={200} />
        <button className="btn" disabled={busy}>{busy ? "…" : "Rewind"}</button>
      </form>
      {out?.error && <p className="muted text-xs" role="status">{out.error}</p>}
      {out?.range && <p className="muted text-xs">{out.range.label}: {out.range.from} to {out.range.to}{out.days?.length ? "" : " · nothing recorded"}</p>}
      {!!out?.days?.length && <ul className="mt-1 max-h-72 space-y-2 overflow-y-auto">
        {out.days.map((d) => (
          <li key={d.day} className="card text-sm">
            <div className="muted text-[11px]">{d.day}</div>
            {d.moments.map((m) => (
              <div key={m.id}>{m.links[0] ? <button className="link text-left" onClick={() => open(m.links[0])}>{m.title}</button> : m.title}{m.first && <span className="muted"> · {m.first}</span>}</div>
            ))}
          </li>
        ))}
      </ul>}
    </div>
  );
}
