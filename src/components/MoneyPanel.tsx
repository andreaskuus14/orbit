"use client";
import { useCallback, useEffect, useState } from "react";
import { euro } from "@/lib/invoices-pure";
import { CATEGORIES, FORMS, SOURCES, VAT_RATES, type Deadline, type Expense, type Pnl, type Settings } from "@/lib/money-pure";
import { localDay } from "@/lib/morning-pure";
import ReconcilePanel from "./ReconcilePanel";
import { askConfirm } from "./ui/Dialog";
import { useT } from "./i18n";

// Money view (roadmap 3) inside BUSINESS: profit & loss by month/quarter/year from paid invoices, his expenses (receipts kept on
// this PC) and ORBIT's own spend; VAT owed vs paid per month; Estonian deadlines; CSV for the accountant. Nothing is filed or paid.

type State = { pnl: Pnl; settings: Settings; expenses: Expense[]; deadlines: Deadline[]; today: string };
const API = "/api/business/money";
async function call(init?: RequestInit, q = "") {
  const res = await fetch(API + q, { cache: "no-store", ...init });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}
const post = (body: object) => call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const KINDS = { month: "mny.month", quarter: "mny.quarter", year: "mny.year" } as const;
const periodOf = (kind: keyof typeof KINDS, day: string) =>
  kind === "year" ? day.slice(0, 4) : kind === "quarter" ? `${day.slice(0, 4)}-Q${Math.ceil(Number(day.slice(5, 7)) / 3)}` : day.slice(0, 7);
const Card = ({ label, cents, warn }: { label: string; cents: number | string; warn?: boolean }) => (
  <div className="card !p-2"><div className="muted text-[12px] font-medium">{label}</div><div className={`num text-lg font-semibold ${warn ? "warn" : ""}`}>{typeof cents === "number" ? euro(cents) : cents}</div></div>
);

export default function MoneyPanel() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<keyof typeof KINDS>("month");
  const [period, setPeriod] = useState("");
  const [st, setSt] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showSet, setShowSet] = useState(false);
  const { t } = useT();

  const load = useCallback(async (p: string) => { setSt(await call(undefined, p ? `?period=${encodeURIComponent(p)}` : "")); }, []);
  useEffect(() => { if (open) load(period).catch((e: Error) => setMsg({ ok: false, text: e.message })); }, [open, period, load]);
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (done) setMsg({ ok: true, text: done }); await load(period); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };

  if (!open) return <button className="chip" onClick={() => setOpen(true)}>💶 {t("mny.money")}</button>;
  const p = st?.pnl, s = st?.settings, sum = p?.sum;
  const shown = p?.period ?? period;
  return (
    <section className="space-y-2 rounded-md border border-white/10 p-2 text-xs" aria-label={t("mny.money")}>
      <div className="flex flex-wrap items-center justify-between gap-2"><b>💶 {t("mny.money")}</b><span className="flex flex-wrap gap-1">
        {(Object.keys(KINDS) as (keyof typeof KINDS)[]).map((k) => <button key={k} className="chip" aria-pressed={kind === k} onClick={() => { setKind(k); setPeriod(periodOf(k, st?.today ?? localDay(new Date()))); }}>{t(KINDS[k])}</button>)}
        <input className="field w-24" aria-label={t("mny.period")} key={shown} defaultValue={shown} onBlur={(e) => setPeriod(e.target.value.trim())} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        <a className="chip" href={`${API}?csv=${encodeURIComponent(shown)}`} download>{t("mny.csv")}</a>
        <button className="chip" onClick={() => setShowSet(!showSet)}>{t("mny.settings")}</button>
        <button className="chip" onClick={() => setOpen(false)}>{t("common.close")}</button></span></div>

      {showSet && s && <SettingsForm s={s} busy={busy} save={(b) => act(() => post({ action: "settings", ...b }), t("lf.saved"))} />}

      {sum && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Card label={t("mny.income")} cents={sum.income} />
          <Card label={t("mny.costs")} cents={sum.costs + sum.orbitApi + sum.orbitHf} />
          <Card label={t("mny.profit")} cents={sum.profit} warn={sum.profit < 0} />
          <Card label={t("mny.margin")} cents={p!.margin === null ? "—" : `${p!.margin} %`} />
        </div>
      )}
      {sum && (
        <table className="w-full"><caption className="sr-only">{t("mny.byKind")}</caption><tbody>
          {p!.byCategory.map((c) => <tr key={c.category}><td>{c.category}</td><td className="num text-right">{euro(c.cents)}</td></tr>)}
          <tr><td>{t("mny.orbitApi")} {s && !s.eurPerUsd && <span className="muted">{t("mny.setUsd")}</span>}</td><td className="num text-right">{euro(sum.orbitApi)}</td></tr>
          <tr><td>{t("mny.orbitHf")} {s && !s.eurPerCredit && <span className="muted">{t("mny.setCredit")}</span>}</td><td className="num text-right">{euro(sum.orbitHf)}</td></tr>
        </tbody></table>
      )}

      {s?.vatRegistered && p && (
        <table className="w-full"><caption className="text-left font-semibold">{t("mny.vatMonth", { basis: t(s.vatBasis === "cash" ? "mny.cashBasis" : "mny.invoiceBasis") })}</caption>
          <thead><tr className="muted text-left"><th>{t("mny.month")}</th><th className="text-right">{t("mny.output")}</th><th className="text-right">{t("mny.input")}</th><th className="text-right">{t("mny.owed")}</th><th className="text-right">{t("mny.paid")}</th></tr></thead>
          <tbody>{p.rows.map((r) => <tr key={r.month}><td>{r.month}</td><td className="num text-right">{euro(r.outVat)}</td><td className="num text-right">{euro(r.inVat)}</td>
            <td className={`num text-right ${r.vatOwed > r.vatPaid ? "warn" : ""}`}>{euro(r.vatOwed)}</td>
            <td className="text-right"><input className="field num w-20 text-right" aria-label={t("mny.vatPaidFor", { month: r.month })} defaultValue={r.vatPaid ? (r.vatPaid / 100).toFixed(2) : ""} key={`${r.month}-${r.vatPaid}`}
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.vatPaid ? (r.vatPaid / 100).toFixed(2) : "")) void act(() => post({ action: "vatPaid", month: r.month, amount: v })); }} /></td></tr>)}</tbody>
        </table>
      )}

      <ReconcilePanel />

      {st && <Deadlines list={st.deadlines} s={st.settings} />}

      <ExpenseForm busy={busy} today={st?.today ?? ""} vatRegistered={!!s?.vatRegistered} add={(fd) => act(() => call({ method: "POST", body: fd }), t("mny.expenseSaved"))} />
      {st && st.expenses.length > 0 && (
        <details><summary className="cursor-pointer">{t("mny.expenses", { n: st.expenses.length })}</summary>
          <table className="w-full"><tbody>{st.expenses.slice(0, 200).map((e) => <tr key={e.id}>
            <td className="num">{e.day}</td><td>{e.category}</td><td>{e.note}</td><td className="num text-right">{euro(e.gross)}</td><td className="num text-right muted">{t("mny.vat")} {euro(e.vat)}</td>
            <td className="text-right">{e.receipt && <a className="chip" href={`${API}?receipt=${e.id}`}>{t("mny.receipt")}</a>}
              <button className="chip" disabled={busy} onClick={async () => { if ((await askConfirm(t("mny.deleteConfirm")))) void act(() => post({ action: "delete", id: e.id })); }}>{t("chats.delete")}</button></td></tr>)}</tbody></table>
        </details>
      )}

      {msg && <p className={msg.ok ? "muted" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      {!st && !msg && <p className="muted">{t("common.loading")}</p>}
    </section>
  );
}

function SettingsForm({ s, busy, save }: { s: Settings; busy: boolean; save: (b: object) => void }) {
  const [f, setF] = useState({ ...s, eurPerUsd: String(s.eurPerUsd), eurPerCredit: String(s.eurPerCredit) });
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label>{t("mny.form")} <select className="chip" value={f.form} onChange={(e) => setF({ ...f, form: e.target.value as Settings["form"] })}><option value="">{t("mny.notSet")}</option>{FORMS.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label><input type="checkbox" checked={f.vatRegistered} onChange={(e) => setF({ ...f, vatRegistered: e.target.checked })} /> {t("mny.vatReg")}</label>
      {f.vatRegistered && <label>{t("mny.vatBasis")} <select className="chip" value={f.vatBasis} onChange={(e) => setF({ ...f, vatBasis: e.target.value as Settings["vatBasis"] })}><option value="invoice">{t("mny.invoiceDate")}</option><option value="cash">{t("mny.cashDate")}</option></select></label>}
      <label>{t("mny.perUsd")} <input className="field w-16" inputMode="decimal" value={f.eurPerUsd} onChange={(e) => setF({ ...f, eurPerUsd: e.target.value })} /></label>
      <label>{t("mny.perCredit")} <input className="field w-16" inputMode="decimal" value={f.eurPerCredit} onChange={(e) => setF({ ...f, eurPerCredit: e.target.value })} /></label>
      <button className="chip" disabled={busy} onClick={() => save(f)}>{t("chats.save")}</button>
    </div>
  );
}

function Deadlines({ list, s }: { list: Deadline[]; s: Settings }) {
  const { t } = useT();
  return (
    <div className="card !p-2 space-y-1">
      <div className="flex items-center justify-between"><b>{t("mny.deadlines")}</b><span className="warn">{t("mny.checkAccountant")}</span></div>
      {!s.form && <p className="muted">{t("mny.pickForm")}</p>}
      {list.length === 0 ? <p className="muted">{t(s.vatRegistered ? "mny.none" : "mny.noneNoVat")}</p> : (
        <ul>{list.map((d) => <li key={d.day + d.title}><span className="num">{d.day}</span> ({d.daysLeft === 0 ? t("mny.today") : `${d.daysLeft} ${t("mny.d")}`}) · {d.title} <span className="muted">· {d.note} · <a href={d.source} target="_blank" rel="noreferrer">{t("mny.source")}</a></span></li>)}</ul>
      )}
      <p className="muted">{t("mny.weekendNote")} <a href={SOURCES.kmd} target="_blank" rel="noreferrer">{t("mny.srcVat")}</a> · <a href={SOURCES.fie} target="_blank" rel="noreferrer">{t("mny.srcFie")}</a> · <a href={SOURCES.tsd} target="_blank" rel="noreferrer">{t("mny.srcTsd")}</a> · <a href={SOURCES.annual} target="_blank" rel="noreferrer">{t("mny.srcAnnual")}</a>.</p>
    </div>
  );
}

function ExpenseForm({ busy, today, vatRegistered, add }: { busy: boolean; today: string; vatRegistered: boolean; add: (fd: FormData) => Promise<void> }) {
  const { t } = useT();
  return (
    <form className="flex flex-wrap items-center gap-1.5" aria-label={t("mny.logExpense")} onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget, fd = new FormData(form);
      fd.set("action", "expense");
      if (!(fd.get("file") as File | null)?.size) fd.delete("file");
      void add(fd).then(() => form.reset());
    }}>
      <input className="field w-28" name="day" type="date" defaultValue={today} aria-label={t("mny.date")} key={today} />
      <select className="chip" name="category" aria-label={t("mny.category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      <input className="field w-20" name="amount" inputMode="decimal" placeholder={t("mny.totalPh")} aria-label={t("mny.amount")} required />
      <select className="chip" name="vatRate" aria-label={t("mny.vatRate")} key={String(vatRegistered)} defaultValue={vatRegistered ? 24 : 0}>{VAT_RATES.map((r) => <option key={r} value={r}>{t("mny.vat")} {r} %</option>)}</select>
      <input className="field w-32" name="note" placeholder={t("mny.whatFor")} aria-label={t("mny.note")} maxLength={200} />
      <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" aria-label={t("mny.receiptFile")} />
      <button className="chip" disabled={busy}>{t("mny.addExpense")}</button>
    </form>
  );
}
