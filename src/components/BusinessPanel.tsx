"use client";
import { OrbitThinks } from "./OrbitThinks";
import VisibilityPanel from "./VisibilityPanel";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { dueFollowups, LANGS, STAGES, STAGE_LABEL, TEMPLATES, emailIn, sendStamp, type Find, type Lang, type Prospect, type Stage, type Template } from "@/lib/business-pure";
import { mapNodes, mapSummary } from "@/lib/business-map-pure";
import { SIG_LABEL, scorecard, type Cell } from "@/lib/outreach-score-pure";
import NicheCards from "./NicheCards";
import InvoicesPanel from "./InvoicesPanel";
import MoneyPanel from "./MoneyPanel";
import ContractsPanel from "./ContractsPanel";
import NegotiatorBox from "./NegotiatorBox";
import WorkspaceFrame, { useWorkspaceView } from "./WorkspaceFrame";
import { useT } from "./i18n";
import { todayQueue } from "@/lib/planet-view-pure";

// Three.js loads after the drawer opens, so the list shows instantly.
const BusinessMap = dynamic(() => import("./BusinessMap"), { ssr: false, loading: () => <div className="h-[260px] rounded-md border border-white/10" /> });

// BUSINESS drawer: the client pipeline for the Lead Follow-up Autopilot (services/lead-followup).
// Add businesses, move them through stages, let CORE draft the first message. Nothing is sent unless you click Approve & send twice (AGENTS.md rule 6).

type Funnel = { counts: Record<Stage, number>; monthly: number; total: number };
type State = { prospects: Prospect[]; funnel: Funnel; canSend?: boolean };

async function call(method: "GET" | "POST", body?: object) {
  const res = await fetch("/api/business", { method, cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const euro = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export default function BusinessPanel({ focusId = null, onFocus }: { focusId?: string | null; onFocus?: (id: string | null) => void } = {}) {
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<Stage | "all" | "followup">("all");
  const [showMap, setShowMap] = useState<boolean | null>(null); // null = default: map when there are businesses
  const [lit, setLit] = useState("");
  const { t } = useT();
  const views = (["today", "pipeline", "client", "money", "setup"] as const).map((id) => ({ id, label: t(`bizws.${id}`), secondary: id === "setup" }));
  const [view, setView] = useWorkspaceView("business", views);

  const load = useCallback(() => call("GET").then((j: State) => { setSt(j); setErr(""); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, body: object) => {
    setBusy(key); setErr("");
    try { await call("POST", body); await load(); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(""); }
  };

  const due = new Set(dueFollowups(st?.prospects ?? [], Date.now()).map((p) => p.id));
  const nodes = mapNodes(st?.prospects ?? [], due);
  const mapOn = showMap ?? nodes.length > 0;
  const pick = (id: string) => {
    setView("client"); setFilter("all"); setLit(id); onFocus?.(id);
    setTimeout(() => document.getElementById(`biz-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    setTimeout(() => setLit((l) => (l === id ? "" : l)), 2500);
  };
  const missing = !!focusId && !!st && !st.prospects.some((p) => p.id === focusId);
  useEffect(() => { if (focusId && st?.prospects.some((p) => p.id === focusId)) pick(focusId); }, [focusId, !!st]); // eslint-disable-line react-hooks/exhaustive-deps
  const addNew = () => { setView("pipeline"); setTimeout(() => (document.querySelector("#biz-add input") as HTMLInputElement | null)?.focus(), 50); };
  const shown = st?.prospects.filter((p) => filter === "all" || (filter === "followup" ? due.has(p.id) : p.stage === filter)) ?? [];
  const queue = todayQueue(st?.prospects ?? [], Date.now());
  return (
    <WorkspaceFrame planet="business" title={t("planet.business")} views={views} view={view} onView={setView}
      context={st && t("bizws.context", { n: st.funnel.total - st.funnel.counts.lost, m: euro(st.funnel.monthly) })}
      action={<button className="chip" onClick={addNew}>{t("bizws.add")}</button>}>
      {err && <p className="error" role="alert">{err}</p>}
      {!st && !err && <p className="muted">Loading…</p>}
      {missing && <p className="muted" role="status">{t("link.missingClient")} <button className="chip" onClick={() => onFocus?.(null)}>{t("link.back")}</button></p>}

      {view === "today" && st && (
        <section className="space-y-2" aria-label={t("bizws.today")}>
          {queue.length ? (
            <ol className="space-y-1.5">
              {queue.map((q) => (
                <li key={`${q.kind}:${q.id}`} className="card !p-2.5 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate"><b>{q.name}</b> <span className="muted">· {t(`bizws.q.${q.kind}`)}</span></span>
                  <button className="chip shrink-0" onClick={() => pick(q.id)}>{t("common.open")}</button>
                </li>
              ))}
            </ol>
          ) : <p className="muted">{t("bizws.empty")}</p>}
        </section>
      )}

      {view === "pipeline" && st && (
        <>
          <div className="grid grid-cols-3 gap-2" aria-label="Pipeline summary">
            <div className="card !p-2.5"><div className="muted text-[10px] uppercase tracking-widest">In pipeline</div><div className="num text-xl font-semibold">{st.funnel.total - st.funnel.counts.lost}</div></div>
            <div className="card !p-2.5"><div className="muted text-[10px] uppercase tracking-widest">Pilots</div><div className="num text-xl font-semibold">{st.funnel.counts.pilot}</div></div>
            <button className="card !p-2.5 text-left" onClick={() => setView("money")} title={t("biz.money.notCash")}><div className="muted text-[10px] uppercase tracking-widest">{t("biz.money.expected")}</div><div className="num text-xl font-semibold">{euro(st.funnel.monthly)}</div><div className="muted text-[10px]">{t("biz.money.notCash")}</div></button>
          </div>
          <div className="space-y-1.5">
            <div className="flex gap-1" role="group" aria-label="Pipeline view">
              <button className="chip" aria-pressed={mapOn} onClick={() => setShowMap(true)}>Map</button>
              <button className="chip" aria-pressed={!mapOn} onClick={() => setShowMap(false)}>List</button>
            </div>
            {mapOn && <><div aria-hidden="true"><BusinessMap nodes={nodes} onPick={pick} /></div><p className="sr-only">{mapSummary(nodes)}</p></>}
            {!mapOn && <button className="chip" onClick={() => setView("client")}>{t("bizws.allClients")}</button>}
          </div>
          <FindNearby busy={busy} setBusy={setBusy} setErr={setErr} names={new Set(st.prospects.map((p) => p.name.toLowerCase()))}
            onAdd={(f) => act(`add:${f.name}`, { action: "add", source: "web-find", name: f.name, kind: f.kind, contact: f.contact, notes: f.why && `Found on the web (unchecked): ${f.why}` })} />
          <div id="biz-add"><AddForm busy={busy === "add"} onAdd={(b) => act("add", { action: "add", ...b })} /></div>
          <Scorecard ps={st.prospects} />
          <VisibilityPanel />
        </>
      )}

      {view === "client" && st && (
        <>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by stage">
            <button className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All {st.funnel.total}</button>
            <button className="chip" aria-pressed={filter === "followup"} onClick={() => setFilter("followup")}>Follow up due {due.size}</button>
            {STAGES.map((s) => <button key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>{STAGE_LABEL[s]} {st.funnel.counts[s]}</button>)}
          </div>
          {!st.prospects.length && <p className="muted">No businesses yet. Add one you could walk into or call this week: a bakery that takes cake orders, a cleaning or renovation firm, a salon.</p>}
          <ul className="space-y-2">
            {shown.map((p) => <Row key={p.id} p={p} lit={lit === p.id} due={due.has(p.id)} busy={busy} act={act} canSend={!!st.canSend} />)}
          </ul>
          <ContractsPanel prospects={st.prospects} />
        </>
      )}

      {view === "money" && <>{st && <InvoicesPanel prospects={st.prospects} />}<MoneyPanel /></>}

      {view === "setup" && (
        <>
          <p className="muted">First product: <b>Lead Follow-up Autopilot</b>. Every website enquiry gets a drafted reply in under a minute; the business owner taps Send or Reject in Telegram.
            Code and setup: <code>services/lead-followup</code>. Win 3 free pilots before charging.</p>
          <NicheCards />
        </>
      )}
    </WorkspaceFrame>
  );
}

function Scorecard({ ps }: { ps: Prospect[] }) {
  const sc = scorecard(ps);
  if (!sc.segments.some((r) => r.sent)) return null;
  const table = (label: string, head: string, rows: Cell[]) => (
    <table className="w-full text-xs" aria-label={label}>
      <thead className="muted text-left"><tr><th>{head}</th><th className="text-right">Sent</th><th className="text-right">Replied</th><th className="text-right">Rate</th><th className="text-right" title="95% range: where the true rate probably is">Range</th><th className="pl-2">Hint</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key}><td>{r.key}</td><td className="num text-right">{r.sent}</td><td className="num text-right">{r.replied}</td><td className="num text-right">{r.sent ? `${r.rate}%` : "–"}</td>
        <td className="num text-right muted">{r.sent ? `${r.low}–${r.high}%` : "–"}</td><td className={`pl-2 ${r.sig === "better" ? "ok" : r.sig === "worse" ? "error" : "muted"} !text-xs`}>{r.sent ? SIG_LABEL[r.sig] : ""}</td></tr>)}</tbody>
    </table>
  );
  return (
    <section className="card space-y-2" aria-label="Outreach scorecard">
      <h3 className="text-[11px] uppercase tracking-widest muted">Outreach scorecard</h3>
      {sc.angles.some((r) => r.sent) && table("Reply rate per message angle", "Angle", sc.angles)}
      {table("Reply rate per business type", "Business type", sc.segments)}
      {sc.next && <p className="text-xs">Next angle to try: <b>{sc.next.angle}</b> <span className="muted">· {sc.next.why}. Pick it in a draft's Angle menu; sending stays your click.</span></p>}
    </section>
  );
}

function FindNearby({ busy, setBusy, setErr, names, onAdd }: { busy: string; setBusy: (k: string) => void; setErr: (e: string) => void; names: Set<string>; onAdd: (f: Find) => Promise<boolean> }) {
  const [q, setQ] = useState("");
  const [finds, setFinds] = useState<Find[]>([]);
  const search = async () => {
    setBusy("find"); setErr("");
    try { setFinds((await call("POST", { action: "find", query: q })).finds); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  return (
    <div className="card space-y-2">
      <form className="flex gap-1.5" aria-label="Find businesses" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input className="field flex-1" aria-label="What to look for" placeholder="Find nearby: cake shops in Tallinn…" maxLength={120} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" disabled={!!busy || !q.trim()}>{busy === "find" ? "CORE is searching…" : "Find"}</button>
      </form>
      {finds.length > 0 && (
        <ul className="space-y-1.5" aria-label="Suggestions">
          {finds.map((f) => (
            <li key={f.name} className="flex items-start justify-between gap-2">
              <div className="min-w-0"><b>{f.name}</b>{f.kind && <span className="muted"> · {f.kind}</span>}
                {f.contact && <div className="muted text-xs break-all">{f.contact}</div>}{f.why && <div className="text-xs">{f.why}</div>}</div>
              <button className="chip shrink-0" disabled={!!busy || names.has(f.name.toLowerCase())} onClick={() => void onAdd(f)}>
                {names.has(f.name.toLowerCase()) ? "Added" : busy === `add:${f.name}` ? "Adding…" : "+ Add"}</button>
            </li>))}
        </ul>)}
      {finds.length > 0 && <p className="muted text-xs">Found on the web by CORE: check each one before you contact them.</p>}
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

function Timeline({ p, busy, act }: { p: Prospect; busy: string; act: (key: string, body: object) => Promise<boolean> }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const ev = p.crm?.events ?? [];
  const log = (kind: string) => void act(`log:${p.id}`, { action: "log", id: p.id, kind, text }).then((ok) => ok && setText(""));
  return (
    <details className="text-xs">
      <summary className="muted cursor-pointer">{t("biz.crm.timeline", { n: ev.length })}{p.touch && ` · ${t("biz.crm.lastTouch", { d: p.touch.last.slice(0, 10) })}`}</summary>
      {ev.length ? <ol className="mt-1 space-y-0.5">{[...ev].reverse().map((e, i) => (
        <li key={i}><span className="num muted">{e.at.slice(0, 16).replace("T", " ")}</span> {t(`biz.crm.ev.${e.kind}`)}{e.text && <span className="muted"> · {e.kind === "stage" && e.text in STAGE_LABEL ? STAGE_LABEL[e.text as Stage] : e.text}</span>}</li>))}</ol>
        : <p className="muted mt-1">{t("biz.crm.none")}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <input className="field flex-1 min-w-32" aria-label={t("biz.crm.what")} placeholder={t("biz.crm.what")} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
        {p.stage !== "lead" && <button className="chip" disabled={!!busy} onClick={() => log("sent")}>{t("biz.crm.logSent")}</button>}
        <button className="chip" disabled={!!busy} onClick={() => log("reply")}>{t("biz.crm.logReply")}</button>
        <button className="chip" disabled={!!busy} onClick={() => log("call")}>{t("biz.crm.logCall")}</button>
        <button className="chip" disabled={!!busy || !text.trim()} onClick={() => log("note")}>{t("biz.crm.logNote")}</button>
      </div>
    </details>
  );
}

function Row({ p, lit, due, busy, act, canSend }: { p: Prospect; lit: boolean; due: boolean; busy: string; act: (key: string, body: object) => Promise<boolean>; canSend: boolean }) {
  const { t } = useT();
  const unverified = p.crm ? !p.crm.verified : false;
  const [notes, setNotes] = useState(p.notes);
  useEffect(() => setNotes(p.notes), [p.notes]); // research rewrites the notes on the server
  const [fee, setFee] = useState(String(p.fee || ""));
  const [lang, setLang] = useState<Lang>("Estonian");
  const [angle, setAngle] = useState<Template | "auto">("auto");
  const [copied, setCopied] = useState(false);
  const [sure, setSure] = useState(false);
  const [sendSure, setSendSure] = useState(false);
  const any = !!busy;
  const to = emailIn(p.contact);
  const update = (fields: object) => act(`upd:${p.id}`, { action: "update", id: p.id, ...fields });
  const copy = async () => {
    try { await navigator.clipboard.writeText(p.draft); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard refused: the text stays selectable */ }
  };
  return (
    <li id={`biz-${p.id}`} className={`card space-y-1.5 transition-shadow ${lit ? "ring-2 ring-amber-400" : ""}`} aria-label={p.name}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0"><b>{p.name}</b>{due && <span className="chip">Follow up due</span>}{p.kind && <span className="muted"> · {p.kind}</span>}{p.contact && <span className="muted select-all"> · {p.contact}</span>}</div>
        <select className="chip" aria-label={`Stage of ${p.name}`} value={p.stage} disabled={any} onChange={(e) => void update({ stage: e.target.value })}>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
      </div>
      {(p.stage === "paying" || p.stage === "pilot") && (
        <label className="flex items-center gap-1.5"><span className="muted">€ / month</span>
          <input className="field w-24" inputMode="decimal" value={fee} disabled={any} onChange={(e) => setFee(e.target.value)} onBlur={() => { if (Number(fee || 0) !== p.fee) void update({ fee: fee || 0 }); }} />
        </label>
      )}
      {unverified && <p className="text-xs"><span className="error">{t("biz.crm.web")}</span> <button className="chip" disabled={any} onClick={() => void act(`verify:${p.id}`, { action: "verify", id: p.id })}>{t("biz.crm.verify")}</button></p>}
      {p.stage === "paying" && p.crm?.opsProject && <p className="text-xs muted">✓ {t("biz.crm.delivery")}</p>}
      <Timeline p={p} busy={busy} act={act} />
      <textarea className="field w-full" rows={2} aria-label={`Notes about ${p.name}`} placeholder="Notes: who you talked to, what they said" maxLength={2000}
        value={notes} disabled={any} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== p.notes) void update({ notes }); }} />
      <div className="flex flex-wrap items-center gap-1.5">
        <select className="chip" aria-label="Message language" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
        <button className="chip" disabled={any} onClick={() => void act(`research:${p.id}`, { action: "research", id: p.id })}>
          {busy === `research:${p.id}` ? "CORE is reading their site…" : "🔎 Research"}</button>
        {p.stage === "lead" && <select className="chip" aria-label="Message angle" value={angle} onChange={(e) => setAngle(e.target.value as Template | "auto")}>
          <option value="auto">Angle: CORE picks</option>{TEMPLATES.map((t) => <option key={t} value={t}>Angle: {t}</option>)}</select>}
        <button className="chip" disabled={any} onClick={() => void act(`draft:${p.id}`, { action: "draft", id: p.id, lang, angle })}>
          {busy === `draft:${p.id}` ? "CORE is writing…" : p.draft ? "✍ Redraft message" : "✍ Draft first message"}</button>
        {p.stage === "contacted" && <button className="chip" disabled={any || !p.draft.trim()} onClick={() => void act(`followup:${p.id}`, { action: "followup", id: p.id, lang })}>
          {busy === `followup:${p.id}` ? "CORE is writing…" : "✍ Draft follow-up"}</button>}
        <button className={`chip ${sure ? "error" : ""}`} disabled={any} onClick={() => (sure ? void act(`del:${p.id}`, { action: "delete", id: p.id }) : (setSure(true), setTimeout(() => setSure(false), 4000)))}>
          {sure ? "Really delete?" : "Delete"}</button>
      </div>
      {p.stage !== "lead" && p.stage !== "lost" && <NegotiatorBox refKey={`prospect:${p.id}`} title={p.name} hint={p.fee ? { floor: p.fee, ceiling: p.fee } : undefined} />}
      {p.draft && (
        <div className="rounded-md border border-white/10 p-2">
          <p className="whitespace-pre-wrap select-all">{p.draft}</p>
          {p.template && <p className="muted text-[11px]">Angle: {p.template}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2"><button className="chip" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
            {canSend && to && p.stage === "lead" && (
              <button className={`chip ${sendSure ? "ok" : ""}`} disabled={any || unverified} title={unverified ? t("biz.crm.verifyFirst") : undefined}
                onClick={() => (sendSure ? (setSendSure(false), void sendStamp(p).then((seen) => act(`send:${p.id}`, { action: "send", id: p.id, seen }))) : (setSendSure(true), setTimeout(() => setSendSure(false), 5000)))}>
                {busy === `send:${p.id}` ? "Sending…" : sendSure ? `Click again to send to ${to}` : `✉ Approve & send to ${to}`}</button>)}
            {canSend && to && p.stage === "lead" && /https?:\/\/|www\./i.test(p.draft) && <span className="error text-[11px]">This draft contains a link: check it's one you meant to send.</span>}
            <span className="muted text-[11px]">{canSend && to && p.stage === "lead" ? "Read it first: nothing is sent until you click twice." : canSend && p.stage === "lead" ? "To send from ORBIT, put one email address in Contact." : "Check it, then send it yourself."} Only say you tested their reply time if you really did. {t("biz.crm.firstOnly")}</span>
            {p.stage === "lead" && <OrbitThinks id={`draft:${p.id}`} />}</div>
        </div>
      )}
    </li>
  );
}
