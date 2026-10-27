"use client";
import { useEffect, useState } from "react";

type Entry = { day: string; text: string; model: boolean };
type View = { entries: Entry[]; total: number; page: number; pages: number };

/** AGENTS → ORBIT's log: ORBIT's own nightly diary (written by the night shift), paged and searchable. */
export function OrbitLog() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const h = setTimeout(() => {
      fetch(`/api/diary?q=${encodeURIComponent(q)}&page=${page}`).then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j: View) => { setV(j); setErr(""); }, () => setErr("Could not load ORBIT's log"));
    }, 250);
    return () => clearTimeout(h);
  }, [q, page]);

  return (
    <section className="space-y-2" aria-label="ORBIT's log">
      <h3 className="h3">ORBIT&apos;s log</h3>
      <input className="field w-full" type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search the log" aria-label="Search ORBIT's log" maxLength={200} />
      {v && !v.entries.length && <p className="muted text-sm">{q ? "No entries match." : "No entries yet. ORBIT writes one at the end of each night shift."}</p>}
      <ul className="space-y-1.5">
        {v?.entries.map((e) => (
          <li key={e.day} className="card text-sm"><b className="text-xs">{e.day}</b> <span className="muted text-xs">{e.model ? "" : "· plain"}</span><p className="mt-1">{e.text}</p></li>
        ))}
      </ul>
      {v && v.pages > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <button className="chip" disabled={v.page <= 1} onClick={() => setPage(v.page - 1)}>Newer</button>
          <span className="muted">Page {v.page} of {v.pages} · {v.total} entries</span>
          <button className="chip" disabled={v.page >= v.pages} onClick={() => setPage(v.page + 1)}>Older</button>
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}
