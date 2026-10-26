"use client";
import { useCallback, useEffect, useState } from "react";
import { REMIND_LANGS, daysLate, euro, totals, view, type Dashboard, type Invoice, type Seller, type View } from "@/lib/invoices-pure";
import type { Negotiation } from "@/lib/negotiator-pure";

// Invoices (roadmap B6) inside BUSINESS: his seller details, drafts made from a prospect or an agreed negotiation, the PDF,
// sent/paid marked by him, who owes what, and reminder drafts for overdue ones. Only "Approve" on a reminder can send, after two clicks.

type State = { seller: Seller | null; invoices: Invoice[]; dashboard: Dashboard; today: string };
async function call(body?: object) {
  const res = await fetch("/api/business/invoices", { method: body ? "POST" : "GET", cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}
const LABEL: Record<View, string> = { draft: "Draft", sent: "Sent", paid: "Paid", overdue: "Overdue" };
const SELLER_FIELDS: [keyof Seller, string][] = [["name", "Name / company"], ["regCode", "Registry code"], ["vatNo", "KMKR (blank if not VAT-registered)"], ["address", "Address"], ["iban", "IBAN"], ["bank", "Bank"], ["email", "Email"], ["phone", "Phone"]];

export default function InvoicesPanel({ prospects }: { prospects: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<State | null>(null);
  const [agreed, setAgreed] = useState<Negotiation[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [from, setFrom] = useState("");
  const [me, setMe] = useState<Record<string, string> | null>(null);
  const [lit, setLit] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSt(await call());
    const n = await fetch("/api/negotiator", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { negotiations: [] }), () => ({ negotiations: [] }));
    setAgreed((n.negotiations as Negotiation[]).filter((x) => x.side === "sell" && x.state === "agreed"));
  }, []);
  useEffect(() => { if (open) load().catch((e: Error) => setMsg({ ok: false, text: e.message })); }, [open, load]);
  const act = async (key: string, body: object, then?: (j: { result?: Invoice; message?: string; text?: string }) => void) => {
    setBusy(key); setMsg(null);
    try { const j = await call(body); then?.(j); if (j.message) setMsg({ ok: true, text: j.message }); await load(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  };

  if (!open) return <button className="chip" onClick={() => setOpen(true)}>🧾 Invoices</button>;
  const d = st?.dashboard;
  return (
    <section className="space-y-2 rounded-md border border-white/10 p-2 text-xs" aria-label="Invoices">
      <div className="flex items-center justify-between gap-2"><b>🧾 Invoices</b><span className="flex gap-1">
        <button className="chip" onClick={() => setMe(me ? null : Object.fromEntries(SELLER_FIELDS.map(([k]) => [k, st?.seller?.[k] ?? ""])))}>Your details</button>
        <button className="chip" onClick={() => setOpen(false)}>Close</button></span></div>

      {me && (
        <div className="space-y-1">
          {SELLER_FIELDS.map(([k, label]) => <label key={k} className="flex items-center gap-1"><span className="muted w-48 shrink-0">{label}</span><input className="field w-full" value={me[k]} onChange={(e) => setMe({ ...me, [k]: e.target.value })} /></label>)}
          <button className="chip" disabled={!!busy} onClick={() => void act("seller", { action: "seller", ...me }, () => setMe(null))}>Save details</button>
        </div>
      )}

      {d && (
        <div className="grid grid-cols-3 gap-2">
          <div className="card !p-2"><div className="muted text-[10px] uppercase tracking-widest">Owed to you</div><div className="num text-lg font-semibold">{euro(d.open)}</div></div>
          <div className="card !p-2"><div className="muted text-[10px] uppercase tracking-widest">Overdue</div><div className={`num text-lg font-semibold ${d.overdue ? "warn" : ""}`}>{euro(d.overdue)}</div></div>
          <div className="card !p-2"><div className="muted text-[10px] uppercase tracking-widest">Paid, 30 days</div><div className="num text-lg font-semibold">{euro(d.paid30)}</div></div>
        </div>
      )}
      {d && d.byBuyer.length > 0 && (
        <table className="w-full"><caption className="sr-only">Who owes what</caption>
          <thead><tr className="muted text-left"><th>Who owes</th><th className="text-right">Open</th><th className="text-right">Overdue</th><th className="text-right">Oldest due</th></tr></thead>
          <tbody>{d.byBuyer.map((o) => <tr key={o.buyer}><td>{o.buyer} ({o.count})</td><td className="num text-right">{euro(o.open)}</td><td className={`num text-right ${o.overdue ? "warn" : ""}`}>{euro(o.overdue)}</td><td className="num text-right">{o.oldestDue}</td></tr>)}</tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <select className="chip max-w-full" aria-label="Make an invoice from" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">New invoice from…</option>
          {agreed.length > 0 && <optgroup label="Agreed negotiations">{agreed.map((n) => <option key={n.id} value={`negotiation:${n.id}`}>{n.title}</option>)}</optgroup>}
          <optgroup label="Businesses">{prospects.map((p) => <option key={p.id} value={`prospect:${p.id}`}>{p.name}</option>)}</optgroup>
        </select>
        <button className="chip" disabled={!from || !!busy} onClick={() => { const [kind, id] = from.split(/:(.*)/); void act("create", { action: "create", from: kind, id }, (j) => { setFrom(""); if (j.result) setLit(j.result.id); }); }}>{busy === "create" ? "…" : "Make draft"}</button>
      </div>

      {msg && <p className={msg.ok ? "muted" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      {!st && !msg && <p className="muted">Loading…</p>}
      {st && !st.invoices.length && <p className="muted">No invoices yet. Fill in Your details, then make one from a business or an agreed negotiation.</p>}
      <ul className="space-y-1.5">
        {st?.invoices.map((i) => <Row key={i.id} i={i} today={st.today} open={lit === i.id} toggle={() => setLit(lit === i.id ? null : i.id)} busy={busy} act={act} />)}
      </ul>
    </section>
  );
}

type Act = (key: string, body: object, then?: (j: { result?: Invoice; message?: string; text?: string }) => void) => Promise<void>;
function Row({ i, today, open, toggle, busy, act }: { i: Invoice; today: string; open: boolean; toggle: () => void; busy: string; act: Act }) {
  const v = view(i, today), t = totals(i), any = !!busy;
  const [f, setF] = useState(() => form(i));
  const [paidOn, setPaidOn] = useState(today);
  const [lang, setLang] = useState<string>("English");
  const [sure, setSure] = useState(false);
  const [copy, setCopy] = useState("");
  useEffect(() => setF(form(i)), [i]);
  const line = (k: number, key: "text" | "qty" | "price", val: string) => setF({ ...f, lines: f.lines.map((l, j) => (j === k ? { ...l, [key]: val } : l)) });
  return (
    <li className={`rounded-md border p-2 ${v === "overdue" ? "border-amber-400/50" : "border-white/10"}`}>
      <button className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={open} onClick={toggle}>
        <span><b>{i.number}</b> · {i.buyer.name}</span>
        <span className="num">{euro(t.gross)} · <span className={v === "overdue" ? "warn" : "muted"}>{LABEL[v]}{v === "overdue" ? ` ${daysLate(i, today)} d` : v === "paid" && i.paidAt ? ` ${i.paidAt}` : ` · due ${i.due}`}</span></span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          <p className="muted">From {i.source.kind === "negotiation" ? "negotiation" : "business"} {i.source.label} · reference {i.ref}{i.reminded.length ? ` · reminded ${i.reminded.length}×, last ${i.reminded.at(-1)!.at.slice(0, 10)}` : ""}</p>
          {i.status === "draft" ? (
            <div className="space-y-1">
              <div className="grid gap-1 sm:grid-cols-2">
                {(["name", "regCode", "vatNo", "address", "email"] as const).map((k) => <input key={k} className="field" aria-label={`Buyer ${k}`} placeholder={{ name: "Buyer name", regCode: "Buyer registry code", vatNo: "Buyer VAT no", address: "Buyer address", email: "Buyer email (for reminders)" }[k]} value={f.buyer[k]} onChange={(e) => setF({ ...f, buyer: { ...f.buyer, [k]: e.target.value } })} />)}
              </div>
              {f.lines.map((l, k) => (
                <div key={k} className="flex gap-1">
                  <input className="field flex-1" aria-label="Description" value={l.text} onChange={(e) => line(k, "text", e.target.value)} />
                  <input className="field w-14" aria-label="Quantity" inputMode="decimal" value={l.qty} onChange={(e) => line(k, "qty", e.target.value)} />
                  <input className="field w-20" aria-label="Unit price € without VAT" inputMode="decimal" value={l.price} onChange={(e) => line(k, "price", e.target.value)} />
                  <button className="chip" aria-label="Remove line" disabled={f.lines.length < 2} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== k) })}>✕</button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <button className="chip" onClick={() => setF({ ...f, lines: [...f.lines, { text: "", qty: "1", price: "" }] })}>+ Line</button>
                <label className="flex items-center gap-1"><input type="checkbox" checked={f.vatOn} onChange={(e) => setF({ ...f, vatOn: e.target.checked })} />VAT</label>
                <label className="flex items-center gap-1"><span className="muted">rate %</span><input className="field w-12" inputMode="decimal" value={f.vatRate} onChange={(e) => setF({ ...f, vatRate: e.target.value })} /></label>
                <label className="flex items-center gap-1"><span className="muted">Date</span><input className="field" type="date" value={f.issued} onChange={(e) => setF({ ...f, issued: e.target.value })} /></label>
                <label className="flex items-center gap-1"><span className="muted">Due</span><input className="field" type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
              </div>
              <textarea className="field w-full" rows={2} placeholder="Note on the invoice (optional)" maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
              <p className="muted num">Net {euro(t.net)}{i.vat.on ? ` · VAT ${i.vat.rate}% ${euro(t.vat)}` : " · no VAT"} · total {euro(t.gross)} (saved values)</p>
              <div className="flex flex-wrap gap-1.5">
                <button className="chip" disabled={any} onClick={() => void act(`edit:${i.id}`, { action: "edit", id: i.id, ...f, vatRate: f.vatRate })}>Save</button>
                <a className="chip" href={`/api/business/invoices?pdf=${i.id}`}>PDF</a>
                <button className="chip" disabled={any} onClick={() => void act(`sent:${i.id}`, { action: "status", id: i.id, to: "sent" })}>I sent it</button>
                <button className="chip" disabled={any} onClick={() => confirm(`Delete draft ${i.number}?`) && void act(`del:${i.id}`, { action: "delete", id: i.id })}>Delete draft</button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <ul>{i.lines.map((l, k) => <li key={k} className="num">{l.text} · {l.qty} × {euro(l.cents)} = {euro(t.lines[k])}</li>)}</ul>
              <div className="flex flex-wrap items-center gap-1.5">
                <a className="chip" href={`/api/business/invoices?pdf=${i.id}`}>PDF</a>
                {i.status === "sent" && <>
                  <input className="field" type="date" aria-label="Paid on" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                  <button className="chip" disabled={any} onClick={() => void act(`paid:${i.id}`, { action: "status", id: i.id, to: "paid", paidOn })}>Mark paid</button>
                  {!i.reminded.length && <button className="chip" disabled={any} onClick={() => void act(`draft:${i.id}`, { action: "status", id: i.id, to: "draft" })}>Back to draft</button>}
                </>}
                {i.status === "paid" && <button className="chip" disabled={any} onClick={() => void act(`unpaid:${i.id}`, { action: "status", id: i.id, to: "sent" })}>Not paid after all</button>}
              </div>
              {v === "overdue" && !i.reminder && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <select className="chip" aria-label="Reminder language" value={lang} onChange={(e) => setLang(e.target.value)}>{REMIND_LANGS.map((l) => <option key={l}>{l}</option>)}</select>
                  <button className="chip" disabled={any} onClick={() => void act(`remind:${i.id}`, { action: "remind", id: i.id, lang })}>Draft a reminder</button>
                </div>
              )}
              {i.reminder && (
                <div className="space-y-1 rounded-md border border-amber-400/40 p-2">
                  <p><b>{i.reminder.subject}</b> → {i.buyer.email || "no email: you'll copy it"}</p>
                  <p className="whitespace-pre-wrap">{i.reminder.text}</p>
                  <div className="flex gap-1.5">
                    <button className={`chip ${sure ? "ok" : ""}`} disabled={any}
                      onClick={() => (sure ? (setSure(false), void act(`approve:${i.id}`, { action: "approve", id: i.id, seen: i.reminder!.at }, (j) => j.text && setCopy(j.text))) : (setSure(true), setTimeout(() => setSure(false), 5000)))}>
                      {busy === `approve:${i.id}` ? "…" : sure ? "Click again to approve" : "✓ Approve"}</button>
                    <button className="chip" disabled={any} onClick={() => void act(`drop:${i.id}`, { action: "drop", id: i.id })}>Discard</button>
                  </div>
                </div>
              )}
              {copy && <div className="space-y-1"><p className="whitespace-pre-wrap">{copy}</p><button className="chip" onClick={() => void navigator.clipboard?.writeText(copy)}>Copy</button></div>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function form(i: Invoice) {
  return {
    buyer: { ...i.buyer }, lines: i.lines.map((l) => ({ text: l.text, qty: String(l.qty), price: (l.cents / 100).toFixed(2) })),
    vatOn: i.vat.on, vatRate: String(i.vat.rate), issued: i.issued, due: i.due, notes: i.notes,
  };
}
