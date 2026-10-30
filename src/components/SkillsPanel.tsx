"use client";
import { useCallback, useEffect, useState } from "react";
import type { Draft, Proposal, Skill, Version } from "@/lib/skills-pure";
import { useT } from "./i18n";

// Agents Station → Skills: what ORBIT noticed he asks CORE for again and again (Keep / Dismiss), and his kept skills
// (edit = candidate version; card + eval + promote, roll back, delete — AGT04). Run one in CORE: "run skill <name>: <input>".
type View = { skills: Skill[]; proposals: Proposal[] };
const currentVersion = (s: Skill) => s.versions.find((v) => v.v === s.current) ?? s.versions[s.versions.length - 1]; // skills-pure's, without its server imports

function DraftForm({ d, busy, label, onSave, onCancel }: { d: Draft; busy: boolean; label: string; onSave: (d: Draft) => void; onCancel: () => void }) {
  const [f, setF] = useState({ ...d, tools: d.tools.join(", ") });
  const field = (k: keyof typeof f, multi = false) => {
    const p = { className: "field w-full", value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }), "aria-label": k };
    return <label className="block text-xs">{k}{multi ? <textarea rows={3} maxLength={600} {...p} /> : <input maxLength={k === "example" ? 300 : 200} {...p} />}</label>;
  };
  return (
    <form className="mt-1 space-y-1" onSubmit={(e) => { e.preventDefault(); onSave({ ...f, tools: f.tools.split(/[\s,]+/).filter(Boolean) }); }}>
      {field("name")}{field("instruction", true)}{field("tools")}{field("example")}
      <div className="flex gap-1"><button type="submit" className="chip" disabled={busy}>{label}</button><button type="button" className="chip" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export default function SkillsPanel() {
  const [v, setV] = useState<View | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(""); // "edit:<id>" | "keep:<id>" | "hist:<id>"
  const [sure, setSure] = useState("");
  const post = useCallback(async (body: Record<string, unknown>, ok = "") => {
    setBusy(String(body.id ?? body.action)); setMsg(null);
    try {
      const r = await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setV(j); setOpen(""); if (ok) setMsg({ ok: true, text: ok });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  }, []);
  // Opening the tab looks for repeats (the server does it at most every 6 h), then shows the list.
  useEffect(() => { void post({ action: "scan" }); }, [post]);
  const del = (s: Skill) => {
    if (sure !== s.id) { setSure(s.id); setTimeout(() => setSure(""), 4000); return; }
    setSure(""); void post({ action: "delete", id: s.id }, "Deleted.");
  };
  return (
    <div className="space-y-2 text-sm">
      <p className="muted text-xs">When you ask CORE for the same multi-step thing 3+ times, ORBIT proposes a skill. Run a kept one in CORE: “run skill &lt;name&gt;: &lt;input&gt;”. Skills use only CORE&apos;s own tools and every approval still applies.</p>
      {msg && <p className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      {!v && <p className="muted">Looking…</p>}
      {v?.proposals.map((p) => (
        <div key={p.id} className="card">
          <b>✨ {p.name}</b> <span className="muted text-xs">· seen {p.support}× · {p.tools.join(" → ")}</span>
          <p className="text-xs">{p.instruction}</p>
          {p.example && <p className="muted text-xs">e.g. “{p.example}”</p>}
          {open === `keep:${p.id}` ? <DraftForm d={p} busy={!!busy} label="Keep" onCancel={() => setOpen("")} onSave={(d) => void post({ action: "keep", id: p.id, edits: d }, `Kept. Say “run skill ${d.name}”.`)} /> : (
            <div className="mt-1 flex gap-1">
              <button type="button" className="chip" disabled={!!busy} onClick={() => void post({ action: "keep", id: p.id }, `Kept. Say “run skill ${p.name}”.`)}>Keep</button>
              <button type="button" className="chip" disabled={!!busy} onClick={() => setOpen(`keep:${p.id}`)}>Edit first</button>
              <button type="button" className="chip" disabled={!!busy} onClick={() => void post({ action: "dismiss", id: p.id })}>Dismiss</button>
            </div>)}
        </div>))}
      {v && !v.skills.length && !v.proposals.length && <p className="muted">No skills yet.</p>}
      <ul className="space-y-1.5">{v?.skills.map((s) => {
        const c = currentVersion(s);
        return (
          <li key={s.id} className="card">
            <b>{c.name}</b> <span className="muted text-xs">· v{c.v} · {c.tools.join(", ")}</span>
            <p className="muted text-xs line-clamp-2">{c.instruction}</p>
            {open === `edit:${s.id}` ? <DraftForm d={c} busy={!!busy} label="Save new version" onCancel={() => setOpen("")} onSave={(d) => void post({ action: "edit", id: s.id, ...d }, "Saved as a candidate version. Fill in its card, eval it, then promote.")} /> : (
              <div className="mt-1 flex flex-wrap gap-1">
                <button type="button" className="chip" disabled={!!busy} onClick={() => setOpen(`edit:${s.id}`)}>Edit</button>
                <button type="button" className="chip" disabled={!!busy} onClick={() => setOpen(open === `hist:${s.id}` ? "" : `hist:${s.id}`)} aria-expanded={open === `hist:${s.id}`}>History ({s.versions.length})</button>
                <button type="button" className={`chip ${sure === s.id ? "error" : ""}`} disabled={!!busy} onClick={() => del(s)} aria-label={`Delete skill ${c.name}`}>{sure === s.id ? "Really?" : "Delete"}</button>
              </div>)}
            {open === `hist:${s.id}` && <ul className="mt-1 space-y-1">{[...s.versions].reverse().map((x) => (
              <li key={x.v} className="space-y-0.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0"><b>v{x.v}</b> <span className="muted">{x.note} · {x.at.slice(0, 10)}</span> {x.name}: {x.instruction}</span>
                  {x.v < s.current && <button type="button" className="chip shrink-0" disabled={!!busy} onClick={() => void post({ action: "rollback", id: s.id, v: x.v }, `Rolled back to v${x.v}.`)}>Roll back</button>}
                </div>
                <VersionMeta s={s} x={x} busy={!!busy} post={post} />
              </li>))}</ul>}
          </li>);
      })}</ul>
    </div>
  );
}

/** AGT04: a version's card (owner, inputs, examples, limits), his eval of it, runs on it, and promote for a candidate. */
function VersionMeta({ s, x, busy, post }: { s: Skill; x: Version; busy: boolean; post: (b: Record<string, unknown>, ok?: string) => Promise<void> }) {
  const { t } = useT();
  const [edit, setEdit] = useState(false);
  const [note, setNote] = useState("");
  const [f, setF] = useState({ owner: x.card?.owner ?? "", inputs: x.card?.inputs ?? "", examples: (x.card?.examples ?? [x.example].filter(Boolean)).join("\n"), limits: x.card?.limits ?? "" });
  const runs = (s.runs ?? []).filter((r) => r.v === x.v).length, cur = x.v === s.current;
  return (
    <div className="muted space-y-0.5 pl-3">
      <p>{cur ? t("sk.current") : x.v > s.current ? t("sk.candidate") : t("sk.older")} · {t("sk.runs", { n: runs })}
        {x.eval ? ` · ${t(x.eval.pass ? "sk.evalPass" : "sk.evalFail", { d: x.eval.at.slice(0, 10) })}${x.eval.note ? `: ${x.eval.note}` : ""}` : ` · ${t("sk.noEval")}`}</p>
      {x.card ? <p>{t("sk.cardLine", { o: x.card.owner, i: x.card.inputs, l: x.card.limits, n: x.card.examples.length })}</p> : <p>{t("sk.noCard")}</p>}
      {edit ? (
        <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); void post({ action: "card", id: s.id, v: x.v, ...f }, t("sk.saved")).then(() => setEdit(false)); }}>
          <input className="field w-full" maxLength={60} placeholder={t("sk.owner")} aria-label={t("sk.owner")} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} />
          <input className="field w-full" maxLength={300} placeholder={t("sk.inputs")} aria-label={t("sk.inputs")} value={f.inputs} onChange={(e) => setF({ ...f, inputs: e.target.value })} />
          <textarea className="field w-full" rows={2} placeholder={t("sk.examples")} aria-label={t("sk.examples")} value={f.examples} onChange={(e) => setF({ ...f, examples: e.target.value })} />
          <input className="field w-full" maxLength={300} placeholder={t("sk.limits")} aria-label={t("sk.limits")} value={f.limits} onChange={(e) => setF({ ...f, limits: e.target.value })} />
          <button className="chip" disabled={busy}>{t("sk.saveCard")}</button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className="chip" disabled={busy} onClick={() => setEdit(true)}>{t("sk.editCard")}</button>
          <input className="field min-w-0 flex-1" maxLength={300} placeholder={t("sk.evalNote", { n: x.name, v: x.v })} aria-label={t("sk.evalNoteAria")} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="chip" disabled={busy} onClick={() => void post({ action: "eval", id: s.id, v: x.v, pass: true, note })}>{t("sk.pass")}</button>
          <button type="button" className="chip" disabled={busy} onClick={() => void post({ action: "eval", id: s.id, v: x.v, pass: false, note })}>{t("sk.fail")}</button>
          {x.v > s.current && <button type="button" className="chip" disabled={busy || !x.card || !x.eval?.pass} onClick={() => void post({ action: "promote", id: s.id, v: x.v }, t("sk.promoted", { v: x.v }))}>{t("sk.promote")}</button>}
        </div>
      )}
    </div>
  );
}
