"use client";
// BUSINESS sheets (opened from the planet's "…" menu in BusinessShell): Clients, Find clients, Money, Insights, Setup.
// Every view reads the one shared state (useBusiness in BusinessShell); actions patch it in place (business-state-pure).
// Nothing is sent unless he clicks Approve & send twice (AGENTS.md rule 6).
import StateNote from "./StateNote";
import VisibilityPanel from "./VisibilityPanel";
import { useEffect, useRef, useState } from "react";
import { dueFollowups, LANGS, STAGES, TEMPLATES, emailIn, sendStamp, type Find, type Lang, type Prospect, type Stage, type Template } from "@/lib/business-pure";
import { WINDOWS, conversion, lostReasons, nextExperiment, scorecard, stalled, windowed, MIN_N, type Cell, type LRow } from "@/lib/outreach-score-pure";
import { LOST_REASONS } from "@/lib/prospect-crm-pure";
import { leadLabel, type Candidate } from "@/lib/lead-loop-pure";
import { euro as euroCents } from "@/lib/invoices-pure";
import type { Bucket, Split } from "@/lib/money-pure";
import type { BizState } from "@/lib/business-state-pure";
import type { Key } from "@/lib/i18n-core-pure";
import NicheCards from "./NicheCards";
import RegistryBox, { RegistryFacts } from "./RegistryBox";
import InvoicesPanel from "./InvoicesPanel";
import MoneyPanel from "./MoneyPanel";
import BusinessOverview from "./BusinessOverview";
import WeeklyOutcome from "./WeeklyOutcome";
import ContractsPanel from "./ContractsPanel";
import DealCards from "./DealCards";
import NegotiatorBox from "./NegotiatorBox";
import { useT } from "./i18n";
import { postWatch } from "./WatchesSection";
import { askText } from "./ui/Dialog";

export type Act = (key: string, body: object) => Promise<boolean>;
/** What every sheet gets from the shell: the shared state and its actions. */
export type Biz = { st: BizState; busy: string; setBusy: (k: string) => void; act: Act; reload: () => void; fail: (msg: string) => void };
type T = ReturnType<typeof useT>["t"];
async function call(method: "POST", body: object) {
  const res = await fetch("/api/business", { method, cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const stageText = (t: T, s: string) => (STAGES.includes(s as Stage) ? t(`bz.stage.${s}` as Key) : s);

/** Clients: stage filter, then one card per business (draft, angle, language, two-click send), contracts and deals. */
export function ClientsView({ biz, lit }: { biz: Biz; lit: string }) {
  const { t } = useT();
  const { st, busy, act, reload } = biz;
  const [filter, setFilter] = useState<Stage | "all" | "followup">("all");
  const due = new Set(dueFollowups(st.prospects, Date.now()).map((p) => p.id));
  useEffect(() => { if (lit) { setFilter("all"); requestAnimationFrame(() => document.getElementById(`biz-${lit}`)?.scrollIntoView({ block: "center" })); } }, [lit]);
  const shown = st.prospects.filter((p) => filter === "all" || (filter === "followup" ? due.has(p.id) : p.stage === filter));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("bz.filter")}>
        <button className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("bz.all", { n: st.funnel.total })}</button>
        <button className="chip" aria-pressed={filter === "followup"} onClick={() => setFilter("followup")}>{t("bz.dueN", { n: due.size })}</button>
        {STAGES.map((s) => <button key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>{stageText(t, s)} {st.funnel.counts[s]}</button>)}
      </div>
      {!st.prospects.length && <p className="muted">{t("bz.noClients")}</p>}
      <ul className="space-y-2">
        {shown.map((p) => <Row key={p.id} reload={reload} p={p} lit={lit === p.id} due={due.has(p.id)} busy={busy} act={act} canSend={!!st.canSend} nightDraft={!!st.nightDrafts?.includes(p.id)} />)}
      </ul>
      <ContractsPanel prospects={st.prospects} />
      <DealCards />
    </div>
  );
}

/** Find clients: web search, the lead loop, the registry and a plain add form. */
export function FindView({ biz }: { biz: Biz }) {
  const { st, busy, setBusy, act, reload, fail } = biz;
  return (
    <div className="space-y-3">
      <FindNearby busy={busy} setBusy={setBusy} setErr={fail} names={new Set(st.prospects.map((p) => p.name.toLowerCase()))}
        onAdd={(f) => act(`add:${f.name}`, { action: "add", source: "web-find", name: f.name, kind: f.kind, contact: f.contact, notes: f.why && `Found on the web (unchecked): ${f.why}` })} />
      <LeadLoopBox busy={busy} setBusy={setBusy} setErr={fail} done={reload} />
      <RegistryBox done={reload} />
      <AddForm busy={busy === "add"} onAdd={(b) => act("add", { action: "add", ...b })} />
    </div>
  );
}

export function MoneyView({ biz, onClient }: { biz: Biz; onClient: (id: string) => void }) {
  return <div className="space-y-3"><BusinessOverview onClient={onClient} onMoney={() => {}} /><MoneySplit /><InvoicesPanel prospects={biz.st.prospects} /><MoneyPanel /></div>;
}

export function InsightsView({ biz }: { biz: Biz }) {
  return <div className="space-y-3"><WeeklyOutcome /><Scorecard ps={biz.st.prospects} /><VisibilityPanel /></div>;
}

export function SetupView() {
  const { t } = useT();
  return <div className="space-y-3"><p className="muted">{t("bz.setup")}</p><NicheCards /></div>;
}

function Scorecard({ ps }: { ps: Prospect[] }) {
  const { t } = useT();
  const [days, setDays] = useState<number>(90);
  const now = Date.now(), rows = windowed(ps as LRow[], days, now), sc = scorecard(rows);
  if (!scorecard(ps).segments.some((r) => r.sent)) return null;
  const w = days ? t(`biz.conv.w${days}` as "biz.conv.w30") : t("biz.conv.w0");
  const table = (label: string, head: string, rows: Cell[]) => (
    <table className="w-full text-xs" aria-label={label}>
      <thead className="muted text-left"><tr><th>{head}</th><th className="text-right">{t("bz.sc.sent")}</th><th className="text-right">{t("bz.sc.replied")}</th><th className="text-right">{t("biz.conv.rate")}</th><th className="text-right" title={t("bz.sc.rangeHelp")}>{t("biz.conv.range")}</th><th className="pl-2">{t("bz.sc.hint")}</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key}><td>{r.key}</td><td className="num text-right">{r.sent}</td><td className="num text-right">{r.replied}</td><td className="num text-right">{r.sent ? `${r.rate}%` : "–"}</td>
        <td className="num text-right muted">{r.sent ? `${r.low}–${r.high}%` : "–"}</td><td className={`pl-2 ${r.sig === "better" ? "ok" : r.sig === "worse" ? "error" : "muted"} !text-xs`}>{r.sent ? t(`bz.sig.${r.sig}` as Key) : ""}</td></tr>)}</tbody>
    </table>
  );
  const steps = conversion(rows, now), lost = lostReasons(rows), stuck = stalled(ps as LRow[], now), exp = nextExperiment(rows, now);
  const label = (s: string) => stageText(t, s);
  const cell = exp?.angle && sc.angles.find((a) => a.key === exp.angle);
  return (
    <section className="card space-y-2" aria-label={t("bz.sc.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t("bz.sc.title")}</h3>
        <span className="flex gap-1" role="group" aria-label={t("biz.conv.window")}>{WINDOWS.map((d) => <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>{t(`biz.conv.w${d}` as "biz.conv.w30")}</button>)}</span>
      </div>
      {sc.angles.some((r) => r.sent) && table(t("bz.sc.byAngle"), t("bz.sc.angle"), sc.angles)}
      {sc.segments.length > 0 && table(t("bz.sc.byType"), t("bz.sc.type"), sc.segments)}
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
      <h3 className="text-sm font-medium">{t("biz.split.title", { d: s.days })}</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map(([k, b, cash]) => (
          <button key={k} className={`card !p-2 text-left ${cash ? "" : "border-dashed opacity-80"}`} aria-pressed={open === k} onClick={() => setOpen(open === k ? "" : k)}>
            <div className="muted text-xs">{t(`biz.split.${k}` as "biz.split.paid")}</div>
            <div className={`num text-lg font-semibold ${!cash ? "muted" : k === "overdue" && b.cents ? "warn" : ""}`}>{euroCents(b.cents)}</div>
            {!cash && <div className="muted text-[10px]">{t("biz.split.notCash")}</div>}
          </button>))}
        <div className="card !p-2"><div className="muted text-xs">{t("biz.split.kept")}</div><div className={`num text-lg font-semibold ${s.kept < 0 ? "warn" : ""}`}>{euroCents(s.kept)}</div></div>
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
      <form className="flex gap-1.5" aria-label={t("bz.find.aria")} onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input className="field flex-1" aria-label={t("bz.find.what")} placeholder={t("bz.find.ph")} maxLength={120} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" disabled={!!busy || !q.trim()}>{busy === "find" ? t("bz.find.busy") : t("bz.find.go")}</button>
      </form>
      {finds.length > 0 && (
        <ul className="space-y-1.5" aria-label={t("bz.find.list")}>
          {finds.map((f) => (
            <li key={f.name} className="flex items-start justify-between gap-2">
              <div className="min-w-0"><b>{f.name}</b>{f.kind && <span className="muted"> · {f.kind}</span>}
                {f.contact && <div className="muted text-xs break-all">{f.contact}</div>}{f.why && <div className="text-xs">{f.why}</div>}</div>
              <button className="chip shrink-0" disabled={!!busy || names.has(f.name.toLowerCase())} onClick={() => void onAdd(f)}>
                {names.has(f.name.toLowerCase()) ? t("bz.added") : busy === `add:${f.name}` ? t("bz.adding") : t("bz.add")}</button>
            </li>))}
        </ul>)}
      {past && <p className="muted text-xs">{t("usage.pastBudget")}</p>}
      {finds.length > 0 && <p className="muted text-xs">{t("bz.find.check")}</p>}
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
          if (!r.prospect) { say(t("bz.ll.skip", { name: c.name, pct: r.verdict.confidence, why: r.verdict.reasons[0] ?? "" })); continue; }
          say(r.resume ? t("bz.ll.resume", { name: c.name, step: r.resume }) : t("bz.ll.build", { name: c.name, pct: r.verdict.confidence }));
          if (r.warning) say(`${c.name}: ${r.warning}`);
          if (r.resume !== "pitch") await post({ action: "demo", id: r.prospect.id, lang });
          await post({ action: "pitch", id: r.prospect.id, lang });
          say(t("bz.ll.done", { name: c.name }));
        } catch (e) { say(`${c.name}: ${(e as Error).message}`); }
        done();
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const importMaps = async () => {
    setBusy("leads"); setErr(""); setLog([]);
    try {
      const r = (await post({ action: "import", text })) as { saved: number; dupes: number; over: number };
      setLog([t(r.over ? "bz.ll.importOver" : "bz.ll.import", { n: r.saved, d: r.dupes, o: r.over })]);
      done();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  return (
    <details className="card space-y-2">
      <summary className="cursor-pointer"><b>{t("biz.lead.title")}</b> <span className="muted text-xs">{t("biz.lead.what")}</span></summary>
      <textarea className="field w-full" rows={4} aria-label={t("biz.lead.list")} placeholder={t("bz.ll.ph")} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-1.5">
        <select className="chip" aria-label={t("biz.lead.lang")} value={lang} onChange={(e) => setLang(e.target.value as "English" | "Estonian")}><option value="Estonian">{t("bz.lang.Estonian")}</option><option value="English">{t("bz.lang.English")}</option></select>
        <button className="btn" disabled={!!busy || !text.trim()} onClick={() => void run()}>{busy === "leads" ? t("biz.lead.working") : t("biz.lead.run")}</button>
        <button className="chip" disabled={!!busy || !text.trim()} onClick={() => void importMaps()}>{t("biz.lead.maps")}</button>
      </div>
      {log.length > 0 && <ul className="text-xs space-y-0.5" aria-live="polite">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      <p className="muted text-xs">{t("biz.lead.safe")}</p>
    </details>
  );
}

function AddForm({ busy, onAdd }: { busy: boolean; onAdd: (b: { name: string; kind: string; contact: string }) => Promise<boolean> }) {
  const { t } = useT();
  const [f, setF] = useState({ name: "", kind: "", contact: "" });
  return (
    <form className="card grid gap-1.5 sm:grid-cols-[1fr_1fr_1fr_auto]" aria-label={t("bz.addForm")} id="biz-add"
      onSubmit={async (e) => { e.preventDefault(); if (await onAdd(f)) setF({ name: "", kind: "", contact: "" }); }}>
      <input className="field" aria-label={t("bz.f.name")} placeholder={t("bz.f.name")} required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="field" aria-label={t("bz.f.kind")} placeholder={t("bz.f.kindPh")} maxLength={80} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} />
      <input className="field" aria-label={t("bz.f.contact")} placeholder={t("bz.f.contactPh")} maxLength={200} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
      <button className="btn" disabled={busy || !f.name.trim()}>{busy ? t("bz.adding") : t("bz.f.add")}</button>
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
        <li key={i}><span className="num muted">{e.at.slice(0, 16).replace("T", " ")}</span> {t(`biz.crm.ev.${e.kind}`)}{e.text && <span className="muted"> · {e.kind === "stage" ? stageText(t, e.text) : e.text}</span>}</li>))}</ol>
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

function Row({ p, lit, due, busy, act, canSend, nightDraft = false, reload }: { reload: () => void; p: Prospect; lit: boolean; due: boolean; busy: string; act: (key: string, body: object) => Promise<boolean>; canSend: boolean; nightDraft?: boolean }) {
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
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (f: () => void, ms: number) => { timers.current.push(setTimeout(f, ms)); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []); // no state flips after the card is gone
  useEffect(() => { setSendSure(false); setSure(false); }, [p.id, p.draft]); // a new draft needs two fresh clicks
  const any = !!busy;
  const to = emailIn(p.contact);
  const update = (fields: object) => act(`upd:${p.id}`, { action: "update", id: p.id, ...fields });
  const copy = async () => {
    try { await navigator.clipboard.writeText(p.draft); setCopied(true); later(() => setCopied(false), 2000); } catch { /* clipboard refused: the text stays selectable */ }
  };
  return (
    <li id={`biz-${p.id}`} className={`card space-y-1.5 transition-shadow ${lit ? "ring-2 ring-amber-400" : ""}`} aria-label={p.name}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0"><b>{p.name}</b>{due && <span className="chip">{t("bz.due")}</span>}{p.crm?.lead && <span className="chip" title={p.crm.lead.evidence.join("\n")}>{leadLabel(p.crm.lead)}</span>}{p.crm?.lead?.demo && <a className="chip" href={p.crm.lead.demo.preview} target="_blank" rel="noreferrer">{t("biz.lead.demo")}</a>}{p.kind && <span className="muted"> · {p.kind}</span>}{p.contact && <span className="muted select-all"> · {p.contact}</span>}</div>
        <select className="chip" aria-label={t("bz.stageOf", { name: p.name })} value={p.stage} disabled={any} onChange={(e) => void update({ stage: e.target.value })}>
          {STAGES.map((s) => <option key={s} value={s}>{stageText(t, s)}</option>)}
        </select>
      </div>
      {(p.stage === "paying" || p.stage === "pilot") && (
        <label className="flex items-center gap-1.5"><span className="muted">{t("bz.perMonth")}</span>
          <input className="field w-24" inputMode="decimal" value={fee} disabled={any} onChange={(e) => setFee(e.target.value)} onBlur={() => { if (Number(fee || 0) !== p.fee) void update({ fee: fee || 0 }); }} />
        </label>
      )}
      {p.stage === "lost" && (
        <label className="flex items-center gap-1.5 text-xs"><span className="muted">{t("biz.lost.reason")}</span>
          <select className="chip" value={p.crm?.lost?.reason ?? ""} disabled={any} onChange={(e) => void act(`lost:${p.id}`, { action: "lost", id: p.id, reason: e.target.value || null })}>
            <option value="">{t("biz.lost.unknown")}</option>{LOST_REASONS.map((r) => <option key={r} value={r}>{t(`biz.lost.${r}` as "biz.lost.price")}</option>)}</select></label>)}
      {p.crm?.lead?.person && <p className="text-xs error" role="note">{t("biz.lead.fie")}</p>}
      <RegistryFacts id={p.id} m={p.crm?.registry} done={reload} />
      {unverified && <p className="text-xs"><span className="error">{t("biz.crm.web")}</span> <button className="chip" disabled={any} onClick={() => void act(`verify:${p.id}`, { action: "verify", id: p.id })}>{t("biz.crm.verify")}</button></p>}
      {p.stage === "paying" && p.crm?.opsProject && <p className="text-xs muted">{t("biz.crm.delivery")}</p>}
      <Timeline p={p} busy={busy} act={act} />
      <textarea className="field w-full" rows={2} aria-label={t("bz.notesOf", { name: p.name })} placeholder={t("bz.notesPh")} maxLength={2000}
        value={notes} disabled={any} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== p.notes) void update({ notes }); }} />
      <div className="flex flex-wrap items-center gap-1.5">
        <select className="chip" aria-label={t("bz.msgLang")} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>{LANGS.map((l) => <option key={l} value={l}>{t(`bz.lang.${l}` as Key)}</option>)}</select>
        <button className="chip" disabled={any} onClick={() => void act(`research:${p.id}`, { action: "research", id: p.id })}>
          {busy === `research:${p.id}` ? t("bz.researching") : t("bz.research")}</button>
        <WatchSite p={p} />
        {p.stage === "lead" && <select className="chip" aria-label={t("bz.angle")} value={angle} onChange={(e) => setAngle(e.target.value as Template | "auto")}>
          <option value="auto">{t("bz.angleAuto")}</option>{TEMPLATES.map((x) => <option key={x} value={x}>{t("bz.angleIs", { a: x })}</option>)}</select>}
        <button className="chip" disabled={any} onClick={() => void act(`draft:${p.id}`, { action: "draft", id: p.id, lang, angle })}>
          {busy === `draft:${p.id}` ? t("bz.writing") : p.draft ? t("bz.redraft") : t("bz.draft")}</button>
        {p.stage === "contacted" && nightDraft && <button className="chip" disabled={any} onClick={() => void act(`night:${p.id}`, { action: "followup", id: p.id, use: "night" })}>
          {busy === `night:${p.id}` ? t("bz.loading2") : t("bz.night")}</button>}
        {p.stage === "contacted" && <button className="chip" disabled={any || !p.draft.trim()} onClick={() => void act(`followup:${p.id}`, { action: "followup", id: p.id, lang })}>
          {busy === `followup:${p.id}` ? t("bz.writing") : t("bz.followup")}</button>}
        <button className={`chip ${sure ? "error" : ""}`} disabled={any} onClick={() => (sure ? void act(`del:${p.id}`, { action: "delete", id: p.id }) : (setSure(true), later(() => setSure(false), 4000)))}>
          {sure ? t("bz.delSure") : t("bz.del")}</button>
      </div>
      {p.stage !== "lead" && p.stage !== "lost" && <NegotiatorBox refKey={`prospect:${p.id}`} title={p.name} hint={p.fee ? { floor: p.fee, ceiling: p.fee } : undefined} />}
      {p.draft && (
        <div className="rounded-md border border-white/10 p-2">
          <p className="whitespace-pre-wrap select-all">{p.draft}</p>
          {p.template && <p className="muted text-[11px]">{t("bz.angleIs", { a: p.template })}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2"><button className="chip" onClick={() => void copy()}>{copied ? t("bz.copied") : t("bz.copy")}</button>
            {canSend && to && p.stage === "lead" && (
              <button className={`chip ${sendSure ? "ok" : ""}`} disabled={any || unverified} title={unverified ? t("biz.crm.verifyFirst") : undefined}
                onClick={() => (sendSure ? (setSendSure(false), void sendStamp(p).then((seen) => act(`send:${p.id}`, { action: "send", id: p.id, seen }))) : (setSendSure(true), later(() => setSendSure(false), 5000)))}>
                {busy === `send:${p.id}` ? t("bz.sending") : sendSure ? t("bz.sendSure", { to }) : t("bz.send", { to })}</button>)}
            {canSend && to && p.stage === "lead" && /https?:\/\/|www\./i.test(p.draft) && <span className="error text-[11px]">{t("bz.hasLink")}</span>}
            <span className="muted text-[11px]">{canSend && to && p.stage === "lead" ? t("bz.sendHint") : canSend && p.stage === "lead" ? t("bz.needEmail") : t("bz.sendSelf")} {t("bz.honest")} {t("biz.crm.firstOnly")}</span>
            </div>
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
    const url = (await askText(t("pw.leadAsk"), { value: guess }))?.trim(); // shortcut: a browser prompt; an inline field if he uses it a lot
    if (!url) return;
    try { await postWatch({ action: "add", url, purpose: `Lead: ${p.name} website`, lead: p.id }); setState(t("pw.leadOn")); }
    catch { setState(t("bz.watchFail")); }
  };
  return <>{state ? <span className="muted text-[11px]">{state}</span> : <button className="chip" onClick={() => void go()}>{t("pw.lead")}</button>}</>;
}
