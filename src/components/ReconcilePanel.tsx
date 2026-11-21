"use client";
import { useEffect, useRef, useState } from "react";
import { clientLang, euro, remindDue, type Invoice } from "@/lib/invoices-pure";
import { overdueUnpaid, parseBank, reconcile, type Field, type Mapping, type Parsed } from "@/lib/reconcile-pure";
import { fromStages } from "@/lib/progress-pure";
import { ProgressCard } from "./ProgressCard";
import { useT } from "./i18n";

// Reconcile (ticket B3) inside BUSINESS → Money: his bank CSV (Swedbank, SEB, LHV or any CSV with a column-mapping step) is read
// in this browser only, never uploaded or stored. Matches are suggestions; "Mark paid" is his click on the existing invoices action.
// Overdue invoices the file shows no payment for get a polite reminder DRAFT in the client's language (clientLang); each waits
// for his own Approve in Invoices. Nothing is sent from here, and Auto never sends invoice reminders.

const API = "/api/business/invoices";
const FIELDS: [Field, string][] = [["day", "Date *"], ["amount", "Amount *"], ["dk", "Debit/credit"], ["ref", "Reference"], ["name", "Payer"], ["text", "Description"]];

export default function ReconcilePanel() {
  const [text, setText] = useState("");
  const [map, setMap] = useState<Mapping | undefined>();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [today, setToday] = useState("");
  const [drafting, setDrafting] = useState<{ total: number; done: number; failed: string[]; at: string } | null>(null);
  const drafted = useRef("");
  const [retry, setRetry] = useState(0);
  const { t, lang } = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadInvoices = async () => {
    const r = await fetch(API, { cache: "no-store" }), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    setInvoices(j.invoices); setToday(j.today ?? new Date().toISOString().slice(0, 10));
  };
  const pick = async (f: File | undefined) => {
    setMsg(null); setMap(undefined);
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return setMsg({ ok: false, text: "The CSV can be at most 5 MB" });
    try { setText(await f.text()); await loadInvoices(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const markPaid = async (id: string, paidOn: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", id, to: "paid", paidOn }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      await loadInvoices(); setMsg({ ok: true, text: "Marked paid" });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };

  const p: Parsed | null = text ? parseBank(text, map) : null;
  const r = p && !p.problem && invoices ? reconcile(p.lines, invoices) : null;
  const unpaid = p && !p.problem && invoices && today ? overdueUnpaid(p.lines, invoices, today) : [];
  const due = new Set(remindDue(unpaid.map((u) => u.invoice), today).map((i) => i.id));
  const todo = unpaid.filter((u) => due.has(u.invoice.id));
  // Once per bank file: draft the missing reminders (drafts only; his Approve in Invoices is the only way out).
  useEffect(() => {
    const key = `${text.length}:${todo.map((u) => u.invoice.id).join(",")}`;
    if (!todo.length || drafted.current === key) return;
    drafted.current = key;
    void (async () => {
      const failed: string[] = [];
      setDrafting({ total: todo.length, done: 0, failed, at: new Date().toISOString() });
      for (const [k, u] of todo.entries()) {
        const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remind", id: u.invoice.id, lang: clientLang(u.invoice.buyer) }) }).catch(() => null);
        if (!res?.ok) failed.push(u.invoice.number);
        setDrafting({ total: todo.length, done: k + 1, failed, at: new Date().toISOString() });
      }
      await loadInvoices().catch(() => {});
    })();
  }, [text, retry, todo.map((u) => u.invoice.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = invoices?.filter((i) => i.reminder).length ?? 0;
  const card = drafting && fromStages({
    id: "reminders", title: t("rec.card"), stages: [t("rec.s.read"), t("rec.s.match"), t("rec.s.draft")], current: drafting.done < drafting.total ? 2 : 3,
    now: drafting.done < drafting.total ? t("rec.now", { n: drafting.done + 1, m: drafting.total }) : null,
    failed: drafting.done >= drafting.total && drafting.failed.length === drafting.total, error: t("rec.failed", { list: drafting.failed.join(", ") }),
    result: drafting.done >= drafting.total ? { text: t("rec.result", { n: drafting.total - drafting.failed.length, w: waiting }) + (drafting.failed.length ? ` ${t("rec.failed", { list: drafting.failed.join(", ") })}` : "") } : null,
    at: drafting.at,
  }, lang, Date.now());
  return (
    <details className="card !p-2 space-y-1"><summary className="cursor-pointer font-semibold">Reconcile with a bank CSV</summary>
      <p className="muted">Swedbank, SEB or LHV export, or any CSV. It is read on this PC only: not uploaded, not saved, not sent to a model.</p>
      <input type="file" accept=".csv,text/csv" aria-label="Bank CSV" onChange={(e) => void pick(e.target.files?.[0])} />
      {p && <p className="muted">Format: {p.format} · {p.lines.length} lines{p.skipped.length ? ` · skipped rows ${p.skipped.slice(0, 10).join(", ")}${p.skipped.length > 10 ? "…" : ""}` : ""}</p>}
      {p && (p.format === "generic" || p.problem) && (
        <div className="flex flex-wrap gap-1.5" aria-label="Column mapping">{FIELDS.map(([f, label]) => (
          <label key={f}>{label} <select className="chip" value={p.mapping[f] ?? ""} onChange={(e) => setMap({ ...p.mapping, [f]: e.target.value === "" ? undefined : Number(e.target.value) })}>
            <option value="">—</option>{p.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>))}</div>
      )}
      {p?.problem && <p className="warn">{p.problem}</p>}
      {r && (<>
        <p className="muted">{r.from} – {r.to}</p>
        <table className="w-full"><caption className="text-left font-semibold">Matched ({r.matched.length})</caption><tbody>
          {r.matched.map((m) => <tr key={m.line.row}><td className="num">{m.line.day}</td><td>{m.line.name} <span className="muted">{m.line.text}</span></td><td>{m.invoice.number} · {m.invoice.buyer.name}</td><td className="muted">{m.by}</td>
            <td className="num text-right">{euro(m.line.cents)}</td>
            <td className="text-right">{m.markPaid ? <button className="chip" disabled={busy} onClick={() => void markPaid(m.markPaid!.id, m.markPaid!.paidOn)}>Mark paid {m.markPaid.paidOn}</button> : <span className="muted">paid {m.invoice.paidAt}</span>}</td></tr>)}
        </tbody></table>
        {card && <ProgressCard p={card} onAction={() => { drafted.current = ""; setRetry((n) => n + 1); }} />}
        <table className="w-full"><caption className="text-left font-semibold">{t("rec.unpaid", { n: unpaid.length })}</caption><tbody>
          {unpaid.map((u) => <tr key={u.invoice.id}><td className="num">{u.invoice.due}</td><td>{u.invoice.number} · {u.invoice.buyer.name}</td><td className="muted">{t("rec.late", { n: u.daysLate })} · {clientLang(u.invoice.buyer)}</td>
            <td className="text-right muted">{u.invoice.reminder ? t("rec.waiting") : due.has(u.invoice.id) ? "" : t("rec.recent")}</td></tr>)}
        </tbody></table>
        {!!unpaid.length && <p className="muted text-xs">{t("rec.safe")}</p>}
        <table className="w-full"><caption className="text-left font-semibold">Money in with no invoice ({r.bankOnly.length})</caption><tbody>
          {r.bankOnly.map((l) => <tr key={l.row}><td className="num">{l.day}</td><td>{l.name}</td><td className="muted">{l.text} {l.ref}</td><td className="num text-right">{euro(l.cents)}</td></tr>)}
        </tbody></table>
        <table className="w-full"><caption className="text-left font-semibold">Paid invoices with no bank line ({r.paidNoBank.length})</caption><tbody>
          {r.paidNoBank.map((i) => <tr key={i.id}><td className="num">{i.paidAt}</td><td>{i.number} · {i.buyer.name}</td></tr>)}
        </tbody></table>
        <table className="w-full"><caption className="text-left font-semibold">Per month (money in vs paid invoices, gross)</caption>
          <thead><tr className="muted text-left"><th>Month</th><th className="text-right">Bank</th><th className="text-right">Invoices</th><th className="text-right">Difference</th></tr></thead>
          <tbody>{r.months.map((x) => <tr key={x.month}><td>{x.month}</td><td className="num text-right">{euro(x.bank)}</td><td className="num text-right">{euro(x.invoices)}</td><td className={`num text-right ${x.diff ? "warn" : ""}`}>{euro(x.diff)}</td></tr>)}</tbody></table>
      </>)}
      {msg && <p className={msg.ok ? "muted" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </details>
  );
}
