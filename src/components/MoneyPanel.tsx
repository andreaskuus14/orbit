"use client";
import { useCallback, useEffect, useState } from "react";
import { euro } from "@/lib/invoices-pure";
import { CATEGORIES, FORMS, SOURCES, VAT_RATES, type Deadline, type Expense, type Pnl, type Settings } from "@/lib/money-pure";

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
const KINDS = { month: "Month", quarter: "Quarter", year: "Year" } as const;
const periodOf = (kind: keyof typeof KINDS, day: string) =>
  kind === "year" ? day.slice(0, 4) : kind === "quarter" ? `${day.slice(0, 4)}-Q${Math.ceil(Number(day.slice(5, 7)) / 3)}` : day.slice(0, 7);
const Card = ({ label, cents, warn }: { label: string; cents: number | string; warn?: boolean }) => (
  <div className="card !p-2"><div className="muted text-[10px] uppercase tracking-widest">{label}</div><div className={`num text-lg font-semibold ${warn ? "warn" : ""}`}>{typeof cents === "number" ? euro(cents) : cents}</div></div>
);

export default function MoneyPanel() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<keyof typeof KINDS>("month");
  const [period, setPeriod] = useState("");
  const [st, setSt] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showSet, setShowSet] = useState(false);

  const load = useCallback(async (p: string) => { setSt(await call(undefined, p ? `?period=${encodeURIComponent(p)}` : "")); }, []);
  useEffect(() => { if (open) load(period).catch((e: Error) => setMsg({ ok: false, text: e.message })); }, [open, period, load]);
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (done) setMsg({ ok: true, text: done }); await load(period); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };

  if (!open) return <button className="chip" onClick={() => setOpen(true)}>💶 Money</button>;
  const p = st?.pnl, s = st?.settings, sum = p?.sum;
  const shown = p?.period ?? period;
  return (
    <section className="space-y-2 rounded-md border border-white/10 p-2 text-xs" aria-label="Money">
      <div className="flex flex-wrap items-center justify-between gap-2"><b>💶 Money</b><span className="flex flex-wrap gap-1">
        {(Object.keys(KINDS) as (keyof typeof KINDS)[]).map((k) => <button key={k} className="chip" aria-pressed={kind === k} onClick={() => { setKind(k); setPeriod(periodOf(k, st?.today ?? new Date().toISOString().slice(0, 10))); }}>{KINDS[k]}</button>)}
        <input className="field w-24" aria-label="Period (2026-10, 2026-Q4 or 2026)" key={shown} defaultValue={shown} onBlur={(e) => setPeriod(e.target.value.trim())} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        <a className="chip" href={`${API}?csv=${encodeURIComponent(shown)}`} download>CSV for accountant</a>
        <button className="chip" onClick={() => setShowSet(!showSet)}>Settings</button>
        <button className="chip" onClick={() => setOpen(false)}>Close</button></span></div>

      {showSet && s && <SettingsForm s={s} busy={busy} save={(b) => act(() => post({ action: "settings", ...b }), "Saved")} />}

      {sum && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Card label="Income (paid, net)" cents={sum.income} />
          <Card label="Costs" cents={sum.costs + sum.orbitApi + sum.orbitHf} />
          <Card label="Profit" cents={sum.profit} warn={sum.profit < 0} />
          <Card label="Margin" cents={p!.margin === null ? "—" : `${p!.margin} %`} />
        </div>
      )}
      {sum && (
        <table className="w-full"><caption className="sr-only">Costs by kind</caption><tbody>
          {p!.byCategory.map((c) => <tr key={c.category}><td>{c.category}</td><td className="num text-right">{euro(c.cents)}</td></tr>)}
          <tr><td>ORBIT: Claude API-equivalent {s && !s.eurPerUsd && <span className="muted">(set € per USD to count it)</span>}</td><td className="num text-right">{euro(sum.orbitApi)}</td></tr>
          <tr><td>ORBIT: Higgsfield credits {s && !s.eurPerCredit && <span className="muted">(set € per credit to count it)</span>}</td><td className="num text-right">{euro(sum.orbitHf)}</td></tr>
        </tbody></table>
      )}

      {s?.vatRegistered && p && (
        <table className="w-full"><caption className="text-left font-semibold">VAT per month (KMD, {s.vatBasis === "cash" ? "cash basis" : "invoice basis"})</caption>
          <thead><tr className="muted text-left"><th>Month</th><th className="text-right">Output</th><th className="text-right">Input</th><th className="text-right">Owed</th><th className="text-right">Paid</th></tr></thead>
          <tbody>{p.rows.map((r) => <tr key={r.month}><td>{r.month}</td><td className="num text-right">{euro(r.outVat)}</td><td className="num text-right">{euro(r.inVat)}</td>
            <td className={`num text-right ${r.vatOwed > r.vatPaid ? "warn" : ""}`}>{euro(r.vatOwed)}</td>
            <td className="text-right"><input className="field num w-20 text-right" aria-label={`VAT paid for ${r.month}`} defaultValue={r.vatPaid ? (r.vatPaid / 100).toFixed(2) : ""} key={`${r.month}-${r.vatPaid}`}
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.vatPaid ? (r.vatPaid / 100).toFixed(2) : "")) void act(() => post({ action: "vatPaid", month: r.month, amount: v })); }} /></td></tr>)}</tbody>
        </table>
      )}

      {st && <Deadlines list={st.deadlines} s={st.settings} />}

      <ExpenseForm busy={busy} today={st?.today ?? ""} vatRegistered={!!s?.vatRegistered} add={(fd) => act(() => call({ method: "POST", body: fd }), "Expense saved")} />
      {st && st.expenses.length > 0 && (
        <details><summary className="cursor-pointer">Expenses ({st.expenses.length})</summary>
          <table className="w-full"><tbody>{st.expenses.slice(0, 200).map((e) => <tr key={e.id}>
            <td className="num">{e.day}</td><td>{e.category}</td><td>{e.note}</td><td className="num text-right">{euro(e.gross)}</td><td className="num text-right muted">VAT {euro(e.vat)}</td>
            <td className="text-right">{e.receipt && <a className="chip" href={`${API}?receipt=${e.id}`}>Receipt</a>}
              <button className="chip" disabled={busy} onClick={() => { if (confirm("Delete this expense and its receipt?")) void act(() => post({ action: "delete", id: e.id })); }}>Delete</button></td></tr>)}</tbody></table>
        </details>
      )}

      {msg && <p className={msg.ok ? "muted" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      {!st && !msg && <p className="muted">Loading…</p>}
    </section>
  );
}

function SettingsForm({ s, busy, save }: { s: Settings; busy: boolean; save: (b: object) => void }) {
  const [f, setF] = useState({ ...s, eurPerUsd: String(s.eurPerUsd), eurPerCredit: String(s.eurPerCredit) });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label>Business form <select className="chip" value={f.form} onChange={(e) => setF({ ...f, form: e.target.value as Settings["form"] })}><option value="">Not set</option>{FORMS.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label><input type="checkbox" checked={f.vatRegistered} onChange={(e) => setF({ ...f, vatRegistered: e.target.checked })} /> VAT-registered (KMKR)</label>
      {f.vatRegistered && <label>VAT basis <select className="chip" value={f.vatBasis} onChange={(e) => setF({ ...f, vatBasis: e.target.value as Settings["vatBasis"] })}><option value="invoice">Invoice date</option><option value="cash">Cash (paid date)</option></select></label>}
      <label>€ per USD <input className="field w-16" inputMode="decimal" value={f.eurPerUsd} onChange={(e) => setF({ ...f, eurPerUsd: e.target.value })} /></label>
      <label>€ per Higgsfield credit <input className="field w-16" inputMode="decimal" value={f.eurPerCredit} onChange={(e) => setF({ ...f, eurPerCredit: e.target.value })} /></label>
      <button className="chip" disabled={busy} onClick={() => save(f)}>Save</button>
    </div>
  );
}

function Deadlines({ list, s }: { list: Deadline[]; s: Settings }) {
  return (
    <div className="card !p-2 space-y-1">
      <div className="flex items-center justify-between"><b>Estonia deadlines</b><span className="warn">Check with an accountant</span></div>
      {!s.form && <p className="muted">Pick FIE or OÜ in Settings to see income tax and annual report dates.</p>}
      {list.length === 0 ? <p className="muted">Nothing in the next 100 days{s.vatRegistered ? "" : " (KMD dates show once you tick VAT-registered)"}.</p> : (
        <ul>{list.map((d) => <li key={d.day + d.title}><span className="num">{d.day}</span> ({d.daysLeft === 0 ? "today" : `${d.daysLeft} d`}) · {d.title} <span className="muted">· {d.note} · <a href={d.source} target="_blank" rel="noreferrer">source</a></span></li>)}</ul>
      )}
      <p className="muted">Weekend and fixed public-holiday dates move to the next working day. Sources: <a href={SOURCES.kmd} target="_blank" rel="noreferrer">EMTA: VAT period</a> · <a href={SOURCES.fie} target="_blank" rel="noreferrer">EMTA: FIE tax calendar</a> · <a href={SOURCES.tsd} target="_blank" rel="noreferrer">EMTA: dividends / TSD</a> · <a href={SOURCES.annual} target="_blank" rel="noreferrer">RIK: annual report</a>.</p>
    </div>
  );
}

function ExpenseForm({ busy, today, vatRegistered, add }: { busy: boolean; today: string; vatRegistered: boolean; add: (fd: FormData) => Promise<void> }) {
  return (
    <form className="flex flex-wrap items-center gap-1.5" aria-label="Log an expense" onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget, fd = new FormData(form);
      fd.set("action", "expense");
      if (!(fd.get("file") as File | null)?.size) fd.delete("file");
      void add(fd).then(() => form.reset());
    }}>
      <input className="field w-28" name="day" type="date" defaultValue={today} aria-label="Date" key={today} />
      <select className="chip" name="category" aria-label="Category">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      <input className="field w-20" name="amount" inputMode="decimal" placeholder="€ total" aria-label="Amount with VAT" required />
      <select className="chip" name="vatRate" aria-label="VAT rate" key={String(vatRegistered)} defaultValue={vatRegistered ? 24 : 0}>{VAT_RATES.map((r) => <option key={r} value={r}>VAT {r} %</option>)}</select>
      <input className="field w-32" name="note" placeholder="What for" aria-label="Note" maxLength={200} />
      <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" aria-label="Receipt (kept on this PC)" />
      <button className="chip" disabled={busy}>Add expense</button>
    </form>
  );
}
