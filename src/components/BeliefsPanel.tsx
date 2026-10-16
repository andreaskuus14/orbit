"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { chainHistory, type Fact } from "@/lib/facts-pure";

// "What do you know about me" may fire before MEMORY mounts: remember it here until MemoryPanel takes it.
let requested = false;
if (typeof window !== "undefined") addEventListener(NAV_EVENT, (e) => { if ((e as CustomEvent<NavTarget>).detail?.beliefs) requested = true; });
export function takeBeliefsRequest(): boolean { const r = requested; requested = false; return r; }

const SOURCE: Record<Fact["source"], string> = { user_said: "you said", inferred: "inferred", document: "from a document" };
const day = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: "medium" });

/** What ORBIT believes about the user: current facts by subject, their superseded history, Edit and Forget. */
export function BeliefsPanel({ onBack }: { onBack: () => void }) {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [missing, setMissing] = useState("");
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<{ id: string; subject: string; statement: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/facts").then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setMissing(r.available ? "" : r.message); setFacts(r.facts ?? []); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>) => {
    if (busy) return false;
    setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/facts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || `Failed (${r.status})`); if (r.status === 409) await load(); return false; }
      await load();
      return true;
    } catch { setErr("Network error; try again."); return false; }
    finally { setBusy(false); }
  };

  // Subjects in order of their newest current fact; each fact's history follows its superseded_by chain, newest first.
  const history = useMemo(() => chainHistory(facts), [facts]);
  const groups = useMemo(() => {
    const by = new Map<string, Fact[]>();
    for (const f of facts) if (f.status === "current") by.set(f.subject, [...(by.get(f.subject) ?? []), f]);
    return [...by.entries()];
  }, [facts]);

  return (
    <div className="space-y-4">
      <button className="link" onClick={onBack}>← Back</button>
      <h3 className="h3">What ORBIT believes</h3>
      <p className="muted text-xs">Taken from your own words in CORE chats. The newest statement on a subject wins; edit or forget anything.</p>
      {missing && <p className="card text-sm" role="status">{missing}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {!missing && !groups.length && <p className="muted text-sm">Nothing yet. Tell CORE things like “I prefer short answers” or “my timezone is CET”.</p>}
      <ul className="space-y-2">
        {groups.map(([subject, current]) => { const old = current.flatMap((f) => history.get(f.id) ?? []); return (
          <li key={subject} className="card text-sm">
            <div className="muted text-xs uppercase tracking-wide">{subject}</div>
            {current.map((f) => edit?.id === f.id ? (
              <form key={f.id} className="mt-1 space-y-1" onSubmit={async (e) => { e.preventDefault(); if (await post({ action: "edit", ...edit })) setEdit(null); }}>
                <input className="field w-full" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} aria-label="Subject" maxLength={60} />
                <textarea autoFocus className="field w-full" value={edit.statement} onChange={(e) => setEdit({ ...edit, statement: e.target.value })} aria-label="Statement" maxLength={300} />
                <div className="flex gap-2"><button className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" className="chip" onClick={() => setEdit(null)}>Cancel</button></div>
              </form>
            ) : (
              <div key={f.id} className="mt-1">
                <div>{f.statement}</div>
                <div className="muted mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span>{SOURCE[f.source] ?? f.source} · {day(f.created_at)}</span>
                  <button type="button" className="chip" aria-label={`Edit: ${f.statement}`} disabled={busy} onClick={() => setEdit({ id: f.id, subject: f.subject, statement: f.statement })}>Edit</button>
                  <button type="button" className="chip" aria-label={`Forget: ${f.statement}`} disabled={busy} onClick={() => { if (confirm(`Forget "${f.statement}"?`)) void post({ action: "forget", id: f.id }); }}>Forget</button>
                </div>
              </div>
            ))}
            {!!old.length && (
              <details className="mt-2">
                <summary className="muted cursor-pointer text-xs">History ({old.length})</summary>
                <ul className="mt-1 space-y-1">
                  {old.map((f) => <li key={f.id} className="muted text-xs"><s>{f.statement}</s> · {SOURCE[f.source] ?? f.source} · {day(f.created_at)}</li>)}
                </ul>
              </details>
            )}
          </li>
        ); })}
      </ul>
    </div>
  );
}
