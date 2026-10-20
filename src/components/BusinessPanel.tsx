"use client";
import { useCallback, useEffect, useState } from "react";
import { LANGS, STAGES, STAGE_LABEL, type Lang, type Prospect, type Stage } from "@/lib/business-pure";

// BUSINESS drawer: the client pipeline for the Lead Follow-up Autopilot (services/lead-followup).
// Add businesses, move them through stages, let CORE draft the first message. ORBIT never sends anything: you copy and send it.

type Funnel = { counts: Record<Stage, number>; monthly: number; total: number };
type State = { prospects: Prospect[]; funnel: Funnel };

async function call(method: "GET" | "POST", body?: object) {
  const res = await fetch("/api/business", { method, cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const euro = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export default function BusinessPanel() {
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<Stage | "all">("all");

  const load = useCallback(() => call("GET").then((j: State) => { setSt(j); setErr(""); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, body: object) => {
    setBusy(key); setErr("");
    try { await call("POST", body); await load(); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(""); }
  };

  const shown = st?.prospects.filter((p) => filter === "all" || p.stage === filter) ?? [];
  return (
    <div className="space-y-3 text-sm">
      <p className="muted">First product: <b>Lead Follow-up Autopilot</b>. Every website enquiry gets a drafted reply in under a minute; the business owner taps Send or Reject in Telegram.
        Code and setup: <code>services/lead-followup</code>. Win 3 free pilots before charging.</p>

      {st && (
        <div className="grid grid-cols-3 gap-2" aria-label="Pipeline summary">
          <div className="card !p-2.5"><div className="muted text-[10px] uppercase tracking-widest">In pipeline</div><div className="num text-xl font-semibold">{st.funnel.total - st.funnel.counts.lost}</div></div>
          <div className="card !p-2.5"><div className="muted text-[10px] uppercase tracking-widest">Pilots</div><div className="num text-xl font-semibold">{st.funnel.counts.pilot}</div></div>
          <div className="card !p-2.5"><div className="muted text-[10px] uppercase tracking-widest">Per month</div><div className="num text-xl font-semibold">{euro(st.funnel.monthly)}</div></div>
        </div>
      )}

      <AddForm busy={busy === "add"} onAdd={(b) => act("add", { action: "add", ...b })} />

      {err && <p className="error" role="alert">{err}</p>}

      {st && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by stage">
          <button className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All {st.funnel.total}</button>
          {STAGES.map((s) => <button key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>{STAGE_LABEL[s]} {st.funnel.counts[s]}</button>)}
        </div>
      )}

      {!st && !err && <p className="muted">Loading…</p>}
      {st && !st.prospects.length && <p className="muted">No businesses yet. Add one you could walk into or call this week: a bakery that takes cake orders, a cleaning or renovation firm, a salon.</p>}

      <ul className="space-y-2">
        {shown.map((p) => <Row key={p.id} p={p} busy={busy} act={act} />)}
      </ul>
    </div>
  );
}

function AddForm({ busy, onAdd }: { busy: boolean; onAdd: (b: { name: string; kind: string; contact: string }) => Promise<boolean> }) {
  const [f, setF] = useState({ name: "", kind: "", contact: "" });
  return (
    <form className="card grid gap-1.5 sm:grid-cols-[1fr_1fr_1fr_auto]" aria-label="Add a business"
      onSubmit={async (e) => { e.preventDefault(); if (await onAdd(f)) setF({ name: "", kind: "", contact: "" }); }}>
      <input className="field" aria-label="Business name" placeholder="Business name" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="field" aria-label="Type of business" placeholder="Type (bakery, salon…)" maxLength={80} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} />
      <input className="field" aria-label="Contact" placeholder="Email, phone or address" maxLength={200} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
      <button className="btn" disabled={busy || !f.name.trim()}>{busy ? "Adding…" : "Add"}</button>
    </form>
  );
}

function Row({ p, busy, act }: { p: Prospect; busy: string; act: (key: string, body: object) => Promise<boolean> }) {
  const [notes, setNotes] = useState(p.notes);
  const [fee, setFee] = useState(String(p.fee || ""));
  const [lang, setLang] = useState<Lang>("Estonian");
  const [copied, setCopied] = useState(false);
  const [sure, setSure] = useState(false);
  const any = !!busy;
  const update = (fields: object) => act(`upd:${p.id}`, { action: "update", id: p.id, ...fields });
  const copy = async () => {
    try { await navigator.clipboard.writeText(p.draft); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard refused: the text stays selectable */ }
  };
  return (
    <li className="card space-y-1.5" aria-label={p.name}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0"><b>{p.name}</b>{p.kind && <span className="muted"> · {p.kind}</span>}{p.contact && <span className="muted select-all"> · {p.contact}</span>}</div>
        <select className="chip" aria-label={`Stage of ${p.name}`} value={p.stage} disabled={any} onChange={(e) => void update({ stage: e.target.value })}>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
      </div>
      {(p.stage === "paying" || p.stage === "pilot") && (
        <label className="flex items-center gap-1.5"><span className="muted">€ / month</span>
          <input className="field w-24" inputMode="decimal" value={fee} disabled={any} onChange={(e) => setFee(e.target.value)} onBlur={() => { if (Number(fee || 0) !== p.fee) void update({ fee: fee || 0 }); }} />
        </label>
      )}
      <textarea className="field w-full" rows={2} aria-label={`Notes about ${p.name}`} placeholder="Notes: who you talked to, what they said" maxLength={2000}
        value={notes} disabled={any} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== p.notes) void update({ notes }); }} />
      <div className="flex flex-wrap items-center gap-1.5">
        <select className="chip" aria-label="Message language" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
        <button className="chip" disabled={any} onClick={() => void act(`draft:${p.id}`, { action: "draft", id: p.id, lang })}>
          {busy === `draft:${p.id}` ? "CORE is writing…" : p.draft ? "✍ Redraft message" : "✍ Draft first message"}</button>
        <button className={`chip ${sure ? "error" : ""}`} disabled={any} onClick={() => (sure ? void act(`del:${p.id}`, { action: "delete", id: p.id }) : (setSure(true), setTimeout(() => setSure(false), 4000)))}>
          {sure ? "Really delete?" : "Delete"}</button>
      </div>
      {p.draft && (
        <div className="rounded-md border border-white/10 p-2">
          <p className="whitespace-pre-wrap select-all">{p.draft}</p>
          <div className="mt-1 flex items-center gap-2"><button className="chip" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
            <span className="muted text-[11px]">Check it, then send it yourself. Only say you tested their reply time if you really did.</span></div>
        </div>
      )}
    </li>
  );
}
