"use client";
import { useCallback, useEffect, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { groupFacts, type Fact } from "@/lib/facts-pure";

// "What do you know about me" may fire before MEMORY mounts: remember it here until MemoryPanel takes it.
let requested = false;
if (typeof window !== "undefined") addEventListener(NAV_EVENT, (e) => { if ((e as CustomEvent<NavTarget>).detail?.beliefs) requested = true; });
export function takeBeliefsRequest(): boolean { const r = requested; requested = false; return r; }

const SOURCE: Record<Fact["source"], string> = { user_said: "you said", inferred: "inferred", document: "from a document" };
const day = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: "medium" });
type Edit = { id: string; subject: string; statement: string };

/** What ORBIT believes about the user: current facts by subject, their superseded history, Edit and Forget. */
export function BeliefsPanel({ onBack }: { onBack: () => void }) {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [missing, setMissing] = useState("");
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
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

  return <BeliefsView facts={facts} missing={missing} error={err} busy={busy} edit={edit} onEdit={setEdit} onBack={onBack}
    onSave={async () => { if (edit && await post({ action: "edit", ...edit })) setEdit(null); }}
    onWrong={async (id) => { if (await post({ action: "wrong", id })) setEdit(null); }}
    onRestore={async (id) => { if (await post({ action: "restore", id })) setEdit(null); }} />;
}

export function BeliefsView({ facts, missing = "", error = "", busy = false, edit = null, onEdit, onBack, onSave, onWrong, onRestore }: {
  facts: Fact[]; missing?: string; error?: string; busy?: boolean; edit?: Edit | null;
  onEdit: (edit: Edit | null) => void; onBack: () => void; onSave: () => void;
  onWrong: (id: string) => void; onRestore: (id: string) => void;
}) {
  const groups = groupFacts(facts);
  const show = (f: Fact) => edit?.id === f.id ? (
    <form key={f.id} className="mt-1 space-y-1" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <input className="field w-full" value={edit.subject} onChange={(e) => onEdit({ ...edit, subject: e.target.value })} aria-label="Subject" maxLength={60} />
      <textarea autoFocus className="field w-full" value={edit.statement} onChange={(e) => onEdit({ ...edit, statement: e.target.value })} aria-label="Statement" maxLength={300} />
      <div className="flex gap-2"><button className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" className="chip" onClick={() => onEdit(null)}>Cancel</button></div>
    </form>
  ) : (
    <div key={f.id} id={`belief-${f.id}`} className="mt-2 space-y-1">
      <div>{f.statement}</div>
      <div className="muted text-xs"><b>{f.status === "current" ? "Current" : f.status === "retracted" ? "Marked wrong — excluded" : "Superseded — excluded"}</b>
        {" · "}{SOURCE[f.source] ?? f.source}{" · "}<time dateTime={f.created_at} title={new Date(f.created_at).toLocaleString()}>{day(f.created_at)}</time></div>
      {f.superseded_by && <p className="muted break-all text-xs">Replaced {f.superseded_at && <time dateTime={f.superseded_at}>{day(f.superseded_at)}</time>} by fact <code>{f.superseded_by}</code></p>}
      {f.status === "retracted" && <p className="muted text-xs">Marked wrong <time dateTime={f.updated_at}>{day(f.updated_at)}</time>.</p>}
      {f.restored_from && <p className="muted break-all text-xs">Restored as a new version from fact <code>{f.restored_from}</code>.</p>}
      {f.source_ref ? <details className="muted text-xs"><summary className="cursor-pointer">{f.source === "user_said" ? "Source message" : "Source reference"}{f.source_created_at ? ` · ${day(f.source_created_at)}` : ""}</summary>
        <p className="whitespace-pre-wrap">{f.source_text ?? "Source message unavailable."}</p><code className="break-all">{f.source_ref}</code></details>
        : <p className="muted text-xs">{f.restored_from ? "Explicitly restored by you." : f.source === "user_said" ? "Direct owner edit; no linked message." : "No linked source reference."}</p>}
      <div className="flex flex-wrap gap-2 text-xs">
        {f.status === "current" && <button type="button" className="chip" aria-label={`Edit: ${f.statement}`} disabled={busy} onClick={() => onEdit({ id: f.id, subject: f.subject, statement: f.statement })}>Edit</button>}
        {f.status !== "retracted" && <button type="button" className="chip" aria-label={`Mark wrong: ${f.statement}`} disabled={busy} onClick={() => onWrong(f.id)}>Mark wrong</button>}
        {f.status !== "current" && <button type="button" className="chip" aria-label={`Restore: ${f.statement}`} disabled={busy} onClick={() => onRestore(f.id)}>Restore</button>}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <button className="link" onClick={onBack}>← Back</button>
      <h3 className="h3">What ORBIT believes</h3>
      <p className="muted text-xs">Current facts come from your own words or edits. Earlier versions stay below. Mark wrong excludes a fact; Restore creates a new current version without erasing history.</p>
      {missing && <p className="card text-sm" role="status">{missing}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!missing && !groups.length && <p className="muted text-sm">Nothing yet. Tell CORE things like “I prefer short answers” or “my timezone is CET”.</p>}
      <ul className="space-y-2">
        {groups.map(({ subject, current, earlier }) => (
          <li key={subject} className="card text-sm">
            <div className="muted text-xs uppercase tracking-wide">{subject}</div>
            {current.map(show)}
            {!current.length && <p className="muted text-xs">No current fact on this subject.</p>}
            {!!earlier.length && (
              <details className="mt-2">
                <summary className="muted cursor-pointer text-xs">Earlier ({earlier.length})</summary>
                <ul className="mt-1 space-y-2">{earlier.map((f) => <li key={f.id}>{show(f)}</li>)}</ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
