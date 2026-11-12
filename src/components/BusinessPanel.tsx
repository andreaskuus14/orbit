"use client";
import { OrbitThinks } from "./OrbitThinks";
import StateNote from "./StateNote";
import VisibilityPanel from "./VisibilityPanel";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { dueFollowups, LANGS, STAGES, STAGE_LABEL, TEMPLATES, emailIn, sendStamp, type Find, type Lang, type Prospect, type Stage, type Template } from "@/lib/business-pure";
import { mapNodes, mapSummary } from "@/lib/business-map-pure";
import { SIG_LABEL, WINDOWS, conversion, lostReasons, nextExperiment, scorecard, stalled, windowed, MIN_N, type Cell, type LRow } from "@/lib/outreach-score-pure";
import { LOST_REASONS } from "@/lib/prospect-crm-pure";
import { leadLabel, type Candidate } from "@/lib/lead-loop-pure";
import { euro as euroCents } from "@/lib/invoices-pure";
import type { Bucket, Split } from "@/lib/money-pure";
import NicheCards from "./NicheCards";
import InvoicesPanel from "./InvoicesPanel";
import MoneyPanel from "./MoneyPanel";
import BusinessOverview from "./BusinessOverview";
import WeeklyOutcome from "./WeeklyOutcome";
import ContractsPanel from "./ContractsPanel";
import NegotiatorBox from "./NegotiatorBox";
import WorkspaceFrame, { useWorkspaceView } from "./WorkspaceFrame";
import { useT } from "./i18n";
import { postWatch } from "./WatchesSection";
import { todayQueue } from "@/lib/planet-view-pure";

// Three.js loads after the drawer opens, so the list shows instantly.
const BusinessMap = dynamic(() => import("./BusinessMap"), { ssr: false, loading: () => <div className="h-[260px] rounded-md border border-white/10" /> });

// BUSINESS drawer: the client pipeline for the Lead Follow-up Autopilot (services/lead-followup).
// Add businesses, move them through stages, let CORE draft the first message. Nothing is sent unless you click Approve & send twice (AGENTS.md rule 6).

type Funnel = { counts: Record<Stage, number>; monthly: number; total: number };
type State = { prospects: Prospect[]; funnel: Funnel; canSend?: boolean; nightDrafts?: string[] }; // nightDrafts: ids with a new follow-up draft from last night

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
      {err ? <StateNote state="failed" what={err} kept={st ? t("state.keptScreen") : undefined} action={{ label: t("state.retry"), run: () => void load() }} />
        : !st && <StateNote state="loading" action={{ label: t("state.retry"), run: () => void load() }} />}
      {missing && <p className="muted" role="status">{t("link.missingClient")} <button className="chip" onClick={() => onFocus?.(null)}>{t("link.back")}</button></p>}
      <BusinessOverview onClient={pick} onMoney={() => setView("money")} />
      <WeeklyOutcome />

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
          <LeadLoopBox busy={busy} setBusy={setBusy} setErr={setErr} done={load} />
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
            {shown.map((p) => <Row key={p.id} p={p} lit={lit === p.id} due={due.has(p.id)} busy={busy} act={act} canSend={!!st.canSend} nightDraft={!!st.nightDrafts?.includes(p.id)} />)}
          </ul>
          <ContractsPanel prospects={st.prospects} />
        </>
      )}

      {view === "money" && <><MoneySplit />{st && <InvoicesPanel prospects={st.prospects} />}<MoneyPanel /></>}

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
  const { t } = useT();
  const [days, setDays] = useState<number>(90);
  const now = Date.now(), rows = windowed(ps as LRow[], days, now), sc = scorecard(rows);
  if (!scorecard(ps).segments.some((r) => r.sent)) return null;
  const w = days ? t(`biz.conv.w${days}` as "biz.conv.w30") : t("biz.conv.w0");
  const table = (label: string, head: string, rows: Cell[]) => (
    <table className="w-full text-xs" aria-label={label}>
      <thead className="muted text-left"><tr><th>{head}</th><th className="text-right">Sent</th><th className="text-right">Replied</th><th className="text-right">Rate</th><th className="text-right" title="95% range: where the true rate probably is">Range</th><th className="pl-2">Hint</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key}><td>{r.key}</td><td className="num text-right">{r.sent}</td><td className="num text-right">{r.replied}</td><td className="num text-right">{r.sent ? `${r.rate}%` : "–"}</td>
        <td className="num text-right muted">{r.sent ? `${r.low}–${r.high}%` : "–"}</td><td className={`pl-2 ${r.sig === "better" ? "ok" : r.sig === "worse" ? "error" : "muted"} !text-xs`}>{r.sent ? SIG_LABEL[r.sig] : ""}</td></tr>)}</tbody>
    </table>
  );
  const steps = conversion(rows, now), lost = lostReasons(rows), stuck = stalled(ps as LRow[], now), exp = nextExperiment(rows, now);
  const label = (s: string) => STAGE_LABEL[s as Stage] ?? s;
  const cell = exp?.angle && sc.angles.find((a) => a.key === exp.angle);
  return (
    <section className="card space-y-2" aria-label="Outreach scorecard">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] uppercase tracking-widest muted">Outreach scorecard</h3>
        <span className="flex gap-1" role="group" aria-label={t("biz.conv.window")}>{WINDOWS.map((d) => <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>{t(`biz.conv.w${d}` as "biz.conv.w30")}</button>)}</span>
      </div>
      {sc.angles.some((r) => r.sent) && table("Reply rate per message angle", "Angle", sc.angles)}
      {sc.segments.length > 0 && table("Reply rate per business type", "Business type", sc.segments)}
      <table className="w-full text-xs" aria-label={t("biz.conv.title")}>
        <thead className="muted text-left"><tr><th>{t("biz.conv.step")}</th><th className="text-right">{t("biz.conv.n")}</th><th className="text-right">{t("biz.conv.k")}</th><th className="text-right">{t("biz.conv.rate")}</th><th className="text-right">{t("biz.conv.range")}</th><th className="text-right">{t("biz.conv.open")}</th></tr></thead>
        <tbody>{steps.map((s) => <tr key={s.from}><td>{label(s.from)} → {label(s.to)}</td><td className="num text-right">{s.n}</td><td className="num text-right">{s.k}</td><td className="num text-right">{s.n ? `${s.rate}%` : "–"}</td>
          <td className="num text-right muted">{s.n ? `${s.low}–${s.high}%` : "–"}</td><td className="num text-right muted">{s.open}</td></tr>)}</tbody>
      </table>
      {lost.length > 0 && <p className="text-xs"><span className="muted">{t("biz.conv.lost")}:</span> {lost.map((l) => `${t(`biz.lost.${l.reason}` as "biz.lost.price")} ${l.n} (${Object.entries(l.after).map(([s, n]) => `${t("biz.conv.after", { s: label(s) })} ${n}`).join(", ")})`).join(" · ")}</p>}
      {stuck.length > 0 && <p className="text-xs"><span className="muted">{t("biz.conv.stalled")}:</span> {stuck.slice(0, 6).map((x) => `${x.name} · ${label(x.stage)} · ${t("biz.conv.days", { d: x.days })}`).join(" · ")}</p>}
      {exp && (
        <div className="rounded-md border border-white/10 p-2 text-xs space-y-0.5">
          <p className="font-semibold">{t("biz.exp.title", { n: MIN_N })}</p>
          <p>{t(`biz.exp.${exp.kind}` as "biz.exp.few", { n: MIN_N, angle: exp.angle ?? "", k: cell ? cell.replied : 0, s: exp.kind === "stalled" ? exp.stalledN ?? 0 : cell ? cell.sent : 0, from: exp.step ? label(exp.step.from) : "", r: exp.reasonN ?? 0 })}</p>
          {exp.step && <p className="muted">{t("biz.exp.basis", { from: label(exp.step.from), to: label(exp.step.to), k: exp.step.k, n: exp.step.n, rate: exp.step.rate, low: exp.step.low, high: exp.step.high, w })}</p>}
          <p className="muted">{t("biz.exp.manual")}</p>
        </div>
      )}
    </section>
  );
}

/** BUS06: the money split. Expected and pipeline are never cash; each total opens the records behind it. */
function MoneySplit() {
  const { t } = useT();
  const [s, setS] = useState<Split | null>(null);
  const [open, setOpen] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { fetch("/api/business/money?split=1", { cache: "no-store" }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); setS(j); }).catch((e: Error) => setErr(e.message)); }, []);
  if (err) return <StateNote state="failed" what={err} />;
  if (!s) return null;
  const cards: [string, Bucket, boolean][] = [["expected", s.expected, false], ["pipeline", s.pipeline, false], ["invoiced", s.invoiced, true], ["overdue", s.overdue, true], ["paid", s.paid, true], ["refunds", s.refunds, true], ["expenses", s.expenses, true]];
  const shown = cards.find(([k]) => k === open)?.[1];
  return (
    <section className="card space-y-2" aria-label={t("biz.split.title", { d: s.days })}>
      <h3 className="text-[11px] uppercase tracking-widest muted">{t("biz.split.title", { d: s.days })}</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map(([k, b, cash]) => (
          <button key={k} className={`card !p-2 text-left ${cash ? "" : "border-dashed opacity-80"}`} aria-pressed={open === k} onClick={() => setOpen(open === k ? "" : k)}>
            <div className="muted text-[10px] uppercase tracking-widest">{t(`biz.split.${k}` as "biz.split.paid")}</div>
            <div className={`num text-lg font-semibold ${!cash ? "muted" : k === "overdue" && b.cents ? "warn" : ""}`}>{euroCents(b.cents)}</div>
            {!cash && <div className="muted text-[10px]">{t("biz.split.notCash")}</div>}
          </button>))}
        <div className="card !p-2"><div className="muted text-[10px] uppercase tracking-widest">{t("biz.split.kept")}</div><div className={`num text-lg font-semibold ${s.kept < 0 ? "warn" : ""}`}>{euroCents(s.kept)}</div></div>
      </div>
      {shown ? (shown.items.length
        ? <ul className="text-xs space-y-0.5">{shown.items.map((i, k) => <li key={`${i.id}:${k}`} className="flex justify-between gap-2"><span className="min-w-0 truncate">{i.label}</span><span className="num">{euroCents(i.cents)}</span></li>)}</ul>
        : <p className="muted text-xs">{t("biz.split.none")}</p>)
        : <p className="muted text-xs">{t("biz.split.hint")}{s.drafts ? ` ${t("biz.split.drafts", { n: s.drafts })}` : ""}</p>}
    </section>
  );
}

function FindNearby({ busy, setBusy, setErr, names, onAdd }: { busy: string; setBusy: (k: string) => void; setErr: (e: string) => void; names: Set<string>; onAdd: (f: Find) => Promise<boolean> }) {
  const [q, setQ] = useState("");
  const [finds, setFinds] = useState<Find[]>([]);
  const [past, setPast] = useState(false);
  const { t } = useT();
  const search = async () => {
    setBusy("find"); setErr("");
    try { const r = await call("POST", { action: "find", query: q }); setFinds(r.finds); setPast(!!r.pastBudget); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
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
      {past && <p className="muted text-xs">{t("usage.pastBudget")}</p>}
      {finds.length > 0 && <p className="muted text-xs">Found on the web by CORE: check each one before you contact them.</p>}
    </div>
  );
}

/** B2 lead loop: candidates → no-website proof → demo site → pitch draft. Each pass lands in the pipeline; nothing is sent. */
function LeadLoopBox({ busy, setBusy, setErr, done }: { busy: string; setBusy: (k: string) => void; setErr: (e: string) => void; done: () => void }) {
  const [text, setText] = useState("");
  const [lang, setLang] = useState<"English" | "Estonian">("Estonian");
  const [log, setLog] = useState<string[]>([]);
  const { t } = useT();
  const post = async (body: object) => {
    const res = await fetch("/api/business/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
    return j;
  };
  const run = async () => {
    setBusy("leads"); setErr(""); setLog([]);
    const say = (l: string) => setLog((x) => [...x, l]);
    try {
      const { candidates } = (await post({ action: "parse", text })) as { candidates: Candidate[] };
      for (const c of candidates) {
        try {
          const r = await post({ action: "check", candidate: c });
          if (!r.prospect) { say(`${c.name}: skipped (${r.verdict.confidence}%): ${r.verdict.reasons[0]}`); continue; }
          say(r.resume ? `${c.name}: continuing from the ${r.resume} step…` : `${c.name}: no website, ${r.verdict.confidence}%. Building demo…`);
          if (r.warning) say(`${c.name}: ${r.warning}`);
          if (r.resume !== "pitch") await post({ action: "demo", id: r.prospect.id, lang });
          await post({ action: "pitch", id: r.prospect.id, lang });
          say(`${c.name}: demo built, pitch drafted. Add their email, fill in [postal address], check it, then Approve & send yourself.`);
        } catch (e) { say(`${c.name}: ${(e as Error).message}`); }
        done();
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  return (
    <details className="card space-y-2">
      <summary className="cursor-pointer"><b>{t("biz.lead.title")}</b> <span className="muted text-xs">{t("biz.lead.what")}</span></summary>
      <textarea className="field w-full" rows={4} aria-label={t("biz.lead.list")} placeholder={"name, city, category, Maps URL (optional)\nKask Pagariäri, Tartu, bakery"} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-1.5">
        <select className="chip" aria-label={t("biz.lead.lang")} value={lang} onChange={(e) => setLang(e.target.value as "English" | "Estonian")}><option>Estonian</option><option>English</option></select>
        <button className="btn" disabled={!!busy || !text.trim()} onClick={() => void run()}>{busy === "leads" ? t("biz.lead.working") : t("biz.lead.run")}</button>
      </div>
      {log.length > 0 && <ul className="text-xs space-y-0.5" aria-live="polite">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      <p className="muted text-xs">{t("biz.lead.safe")}</p>
    </details>
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

function Row({ p, lit, due, busy, act, canSend, nightDraft = false }: { p: Prospect; lit: boolean; due: boolean; busy: string; act: (key: string, body: object) => Promise<boolean>; canSend: boolean; nightDraft?: boolean }) {
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
        <div className="min-w-0"><b>{p.name}</b>{due && <span className="chip">Follow up due</span>}{p.crm?.lead && <span className="chip" title={p.crm.lead.evidence.join("\n")}>{leadLabel(p.crm.lead)}</span>}{p.crm?.lead?.demo && <a className="chip" href={p.crm.lead.demo.preview} target="_blank" rel="noreferrer">{t("biz.lead.demo")}</a>}{p.kind && <span className="muted"> · {p.kind}</span>}{p.contact && <span className="muted select-all"> · {p.contact}</span>}</div>
        <select className="chip" aria-label={`Stage of ${p.name}`} value={p.stage} disabled={any} onChange={(e) => void update({ stage: e.target.value })}>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
      </div>
      {(p.stage === "paying" || p.stage === "pilot") && (
        <label className="flex items-center gap-1.5"><span className="muted">€ / month</span>
          <input className="field w-24" inputMode="decimal" value={fee} disabled={any} onChange={(e) => setFee(e.target.value)} onBlur={() => { if (Number(fee || 0) !== p.fee) void update({ fee: fee || 0 }); }} />
        </label>
      )}
      {p.stage === "lost" && (
        <label className="flex items-center gap-1.5 text-xs"><span className="muted">{t("biz.lost.reason")}</span>
          <select className="chip" value={p.crm?.lost?.reason ?? ""} disabled={any} onChange={(e) => void act(`lost:${p.id}`, { action: "lost", id: p.id, reason: e.target.value || null })}>
            <option value="">{t("biz.lost.unknown")}</option>{LOST_REASONS.map((r) => <option key={r} value={r}>{t(`biz.lost.${r}` as "biz.lost.price")}</option>)}</select></label>)}
      {p.crm?.lead?.person && <p className="text-xs error" role="note">{t("biz.lead.fie")}</p>}
      {unverified && <p className="text-xs"><span className="error">{t("biz.crm.web")}</span> <button className="chip" disabled={any} onClick={() => void act(`verify:${p.id}`, { action: "verify", id: p.id })}>{t("biz.crm.verify")}</button></p>}
      {p.stage === "paying" && p.crm?.opsProject && <p className="text-xs muted">✓ {t("biz.crm.delivery")}</p>}
      <Timeline p={p} busy={busy} act={act} />
      <textarea className="field w-full" rows={2} aria-label={`Notes about ${p.name}`} placeholder="Notes: who you talked to, what they said" maxLength={2000}
        value={notes} disabled={any} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== p.notes) void update({ notes }); }} />
      <div className="flex flex-wrap items-center gap-1.5">
        <select className="chip" aria-label="Message language" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
        <button className="chip" disabled={any} onClick={() => void act(`research:${p.id}`, { action: "research", id: p.id })}>
          {busy === `research:${p.id}` ? "CORE is reading their site…" : "🔎 Research"}</button>
        <WatchSite p={p} />
        {p.stage === "lead" && <select className="chip" aria-label="Message angle" value={angle} onChange={(e) => setAngle(e.target.value as Template | "auto")}>
          <option value="auto">Angle: CORE picks</option>{TEMPLATES.map((t) => <option key={t} value={t}>Angle: {t}</option>)}</select>}
        <button className="chip" disabled={any} onClick={() => void act(`draft:${p.id}`, { action: "draft", id: p.id, lang, angle })}>
          {busy === `draft:${p.id}` ? "CORE is writing…" : p.draft ? "✍ Redraft message" : "✍ Draft first message"}</button>
        {p.stage === "contacted" && nightDraft && <button className="chip" disabled={any} onClick={() => void act(`night:${p.id}`, { action: "followup", id: p.id, use: "night" })}>
          {busy === `night:${p.id}` ? "Loading…" : "🌙 Use last night's draft"}</button>}
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

/** BUSINESS → lead row: watch the lead's website (no site yet → tells him when it goes live; outdated → when it changes). */
function WatchSite({ p }: { p: Prospect }) {
  const { t } = useT();
  const [state, setState] = useState("");
  const guess = p.contact.match(/https?:\/\/\S+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/i)?.[0] ?? ""; // a site, or the domain of their email
  const go = async () => {
    const url = prompt(t("pw.leadAsk"), guess)?.trim(); // shortcut: a browser prompt; an inline field if he uses it a lot
    if (!url) return;
    try { await postWatch({ action: "add", url, purpose: `Lead: ${p.name} website`, lead: p.id }); setState(t("pw.leadOn")); }
    catch (e) { setState(e instanceof Error ? e.message : "Could not add the watch"); }
  };
  return <>{state ? <span className="muted text-[11px]">{state}</span> : <button className="chip" onClick={() => void go()}>{t("pw.lead")}</button>}</>;
}
