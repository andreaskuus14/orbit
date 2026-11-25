"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "./i18n";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { groupFacts, type Fact } from "@/lib/facts-pure";

// "What do you know about me" may fire before MEMORY mounts: remember it here until MemoryPanel takes it.
let requested = false;
if (typeof window !== "undefined") addEventListener(NAV_EVENT, (e) => { if ((e as CustomEvent<NavTarget>).detail?.beliefs) requested = true; });
export function takeBeliefsRequest(): boolean { const r = requested; requested = false; return r; }
export const beliefsPending = () => requested;

const SOURCE = { user_said: "bel.srcSaid", inferred: "bel.srcInferred", document: "bel.srcDoc" } as const;
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
  const { t } = useT();
  const groups = groupFacts(facts);
  const show = (f: Fact) => edit?.id === f.id ? (
    <form key={f.id} className="mt-1 space-y-1" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <input className="field w-full" value={edit.subject} onChange={(e) => onEdit({ ...edit, subject: e.target.value })} aria-label={t("bel.subject")} maxLength={60} />
      <textarea autoFocus className="field w-full" value={edit.statement} onChange={(e) => onEdit({ ...edit, statement: e.target.value })} aria-label={t("bel.statement")} maxLength={300} />
      <div className="flex gap-2"><button className="btn" disabled={busy}>{busy ? t("bel.saving") : t("bel.save")}</button><button type="button" className="chip" onClick={() => onEdit(null)}>{t("bel.cancel")}</button></div>
    </form>
  ) : (
    <div key={f.id} id={`belief-${f.id}`} className="mt-2 space-y-1">
      <div>{f.statement}</div>
      <div className="muted text-xs"><b>{f.status === "current" ? t("bel.current") : f.status === "retracted" ? t("bel.wrongEx") : t("bel.superEx")}</b>
        {" · "}{SOURCE[f.source as keyof typeof SOURCE] ? t(SOURCE[f.source as keyof typeof SOURCE]) : f.source}{" · "}<time dateTime={f.created_at} title={new Date(f.created_at).toLocaleString()}>{day(f.created_at)}</time></div>
      {f.superseded_by && <p className="muted break-all text-xs">{t("bel.replaced")} {f.superseded_at && <time dateTime={f.superseded_at}>{day(f.superseded_at)}</time>} {t("bel.byFact")} <code>{f.superseded_by}</code></p>}
      {f.status === "retracted" && <p className="muted text-xs">{t("bel.markedWrong")} <time dateTime={f.updated_at}>{day(f.updated_at)}</time>.</p>}
      {f.restored_from && <p className="muted break-all text-xs">{t("bel.restoredFrom")} <code>{f.restored_from}</code>.</p>}
      {f.source_ref ? <details className="muted text-xs"><summary className="cursor-pointer">{f.source === "user_said" ? t("bel.srcMsg") : t("bel.srcRef")}{f.source_created_at ? ` · ${day(f.source_created_at)}` : ""}</summary>
        <p className="whitespace-pre-wrap">{f.source_text ?? t("bel.srcGone")}</p><code className="break-all">{f.source_ref}</code></details>
        : <p className="muted text-xs">{f.restored_from ? t("bel.byYou") : f.source === "user_said" ? t("bel.direct") : t("bel.noRef")}</p>}
      <div className="flex flex-wrap gap-2 text-xs">
        {f.status === "current" && <button type="button" className="chip" aria-label={t("bel.editL", { s: f.statement })} disabled={busy} onClick={() => onEdit({ id: f.id, subject: f.subject, statement: f.statement })}>{t("bel.edit")}</button>}
        {f.status !== "retracted" && <button type="button" className="chip" aria-label={t("bel.wrongL", { s: f.statement })} disabled={busy} onClick={() => onWrong(f.id)}>{t("bel.wrong")}</button>}
        {f.status !== "current" && <button type="button" className="chip" aria-label={t("bel.restoreL", { s: f.statement })} disabled={busy} onClick={() => onRestore(f.id)}>{t("bel.restore")}</button>}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <button className="link" onClick={onBack}>{t("bel.back")}</button>
      <h3 className="h3">{t("bel.title")}</h3>
      <p className="muted text-xs">{t("bel.help")}</p>
      {missing && <p className="card text-sm" role="status">{missing}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!missing && !groups.length && <p className="muted text-sm">{t("bel.empty")}</p>}
      <ul className="space-y-2">
        {groups.map(({ subject, current, earlier }) => (
          <li key={subject} className="card text-sm">
            <div className="muted text-xs">{subject}</div>
            {current.map(show)}
            {!current.length && <p className="muted text-xs">{t("bel.noCurrent")}</p>}
            {!!earlier.length && (
              <details className="mt-2">
                <summary className="muted cursor-pointer text-xs">{t("bel.earlier", { n: earlier.length })}</summary>
                <ul className="mt-1 space-y-2">{earlier.map((f) => <li key={f.id}>{show(f)}</li>)}</ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
