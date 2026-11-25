"use client";
import { useCallback, useEffect, useState } from "react";
import { contentHash } from "@/lib/approval-pure";
import { useT } from "./i18n";
import { REMIND_LANGS, reminderContent, daysLate, euro, refunded, totals, view, type Dashboard, type Invoice, type Seller, type View } from "@/lib/invoices-pure";
import type { Negotiation } from "@/lib/negotiator-pure";
import { askConfirm } from "./ui/Dialog";
import type { Key } from "@/lib/i18n-en-pure";

// Invoices (roadmap B6) inside BUSINESS: his seller details, drafts made from a prospect or an agreed negotiation, the PDF,
// sent/paid marked by him, who owes what, and reminder drafts for overdue ones. Only "Approve" on a reminder can send, after two clicks.

type State = { seller: Seller | null; invoices: Invoice[]; dashboard: Dashboard; today: string; stripe?: boolean };
async function call(body?: object) {
  const res = await fetch("/api/business/invoices", { method: body ? "POST" : "GET", cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}
const LABEL: Record<View, Key> = { draft: "invp.draft", sent: "invp.sent", paid: "invp.paid", overdue: "invp.overdue" };
const SELLER_FIELDS: [keyof Seller, Key][] = [["name", "invp.f.name"], ["regCode", "invp.f.reg"], ["vatNo", "invp.f.vat"], ["address", "invp.f.address"], ["iban", "invp.f.iban"], ["bank", "invp.f.bank"], ["email", "invp.f.email"], ["phone", "invp.f.phone"]];

export default function InvoicesPanel({ prospects }: { prospects: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<State | null>(null);
  const [agreed, setAgreed] = useState<Negotiation[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [from, setFrom] = useState("");
  const [me, setMe] = useState<Record<string, string> | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  const { t } = useT();

  const load = useCallback(async () => {
    setSt(await call());
    const n = await fetch("/api/negotiator", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { negotiations: [] }), () => ({ negotiations: [] }));
    setAgreed((n.negotiations as Negotiation[]).filter((x) => x.side === "sell" && x.state === "agreed"));
  }, []);
  useEffect(() => { if (open) load().catch((e: Error) => setMsg({ ok: false, text: e.message })); }, [open, load]);
  const act = async (key: string, body: object, then?: (j: { result?: Invoice; message?: string; text?: string; warning?: string }) => void) => {
    setBusy(key); setMsg(null);
    try { const j = await call(body); then?.(j); if (j.message) setMsg({ ok: true, text: j.message }); if (j.warning) setMsg({ ok: false, text: j.warning }); await load(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  };

  if (!open) return <button className="chip" onClick={() => setOpen(true)}>🧾 {t("invp.title")}</button>;
  const d = st?.dashboard;
  return (
    <section className="space-y-2 rounded-md border border-white/10 p-2 text-xs" aria-label={t("invp.title")}>
      <div className="flex items-center justify-between gap-2"><b>🧾 {t("invp.title")}</b><span className="flex gap-1">
        <button className="chip" onClick={() => setMe(me ? null : Object.fromEntries(SELLER_FIELDS.map(([k]) => [k, st?.seller?.[k] ?? ""])))}>{t("invp.details")}</button>
        <button className="chip" onClick={() => setOpen(false)}>{t("common.close")}</button></span></div>

      {me && (
        <div className="space-y-1">
          {SELLER_FIELDS.map(([k, label]) => <label key={k} className="flex items-center gap-1"><span className="muted w-48 shrink-0">{t(label)}</span><input className="field w-full" value={me[k]} onChange={(e) => setMe({ ...me, [k]: e.target.value })} /></label>)}
          <button className="chip" disabled={!!busy} onClick={() => void act("seller", { action: "seller", ...me }, () => setMe(null))}>{t("invp.saveDetails")}</button>
        </div>
      )}

      {d && (
        <div className="grid grid-cols-3 gap-2">
          <div className="card !p-2"><div className="muted text-[12px] font-medium">{t("invp.owed")}</div><div className="num text-lg font-semibold">{euro(d.open)}</div></div>
          <div className="card !p-2"><div className="muted text-[12px] font-medium">{t("invp.overdue")}</div><div className={`num text-lg font-semibold ${d.overdue ? "warn" : ""}`}>{euro(d.overdue)}</div></div>
          <div className="card !p-2"><div className="muted text-[12px] font-medium">{t("invp.paid30")}</div><div className="num text-lg font-semibold">{euro(d.paid30)}</div>
            {d.refunds30 > 0 && <div className="muted text-[10px]">{t("inv.refunds30")} {euro(d.refunds30)}</div>}</div>
        </div>
      )}
      {d && d.byBuyer.length > 0 && (
        <table className="w-full"><caption className="sr-only">{t("invp.whoOwesWhat")}</caption>
          <thead><tr className="muted text-left"><th>{t("invp.whoOwes")}</th><th className="text-right">{t("invp.open")}</th><th className="text-right">{t("invp.overdue")}</th><th className="text-right">{t("invp.oldest")}</th></tr></thead>
          <tbody>{d.byBuyer.map((o) => <tr key={o.buyer}><td>{o.buyer} ({o.count})</td><td className="num text-right">{euro(o.open)}</td><td className={`num text-right ${o.overdue ? "warn" : ""}`}>{euro(o.overdue)}</td><td className="num text-right">{o.oldestDue}</td></tr>)}</tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <select className="chip max-w-full" aria-label={t("invp.makeFrom")} value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">{t("invp.newFrom")}</option>
          {agreed.length > 0 && <optgroup label={t("invp.agreed")}>{agreed.map((n) => <option key={n.id} value={`negotiation:${n.id}`}>{n.title}</option>)}</optgroup>}
          <optgroup label={t("invp.businesses")}>{prospects.map((p) => <option key={p.id} value={`prospect:${p.id}`}>{p.name}</option>)}</optgroup>
        </select>
        <button className="chip" disabled={!from || !!busy} onClick={() => { const [kind, id] = from.split(/:(.*)/); void act("create", { action: "create", from: kind, id }, (j) => { setFrom(""); if (j.result) setLit(j.result.id); }); }}>{busy === "create" ? "…" : t("invp.makeDraft")}</button>
      </div>

      {msg && <p className={msg.ok ? "muted" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      {!st && !msg && <p className="muted">{t("common.loading")}</p>}
      {st && !st.invoices.length && <p className="muted">{t("invp.empty")}</p>}
      <ul className="space-y-1.5">
        {st?.invoices.map((i) => <Row key={i.id} i={i} today={st.today} stripe={st.stripe} open={lit === i.id} toggle={() => setLit(lit === i.id ? null : i.id)} busy={busy} act={act} />)}
      </ul>
    </section>
  );
}

const BUYER: Record<"name" | "regCode" | "vatNo" | "address" | "email", Key> = { name: "invp.b.name", regCode: "invp.b.reg", vatNo: "invp.b.vat", address: "invp.b.address", email: "invp.b.email" };
type Act = (key: string, body: object, then?: (j: { result?: Invoice; message?: string; text?: string }) => void) => Promise<void>;
function Row({ i, today, stripe, open, toggle, busy, act }: { i: Invoice; today: string; stripe?: boolean; open: boolean; toggle: () => void; busy: string; act: Act }) {
  const v = view(i, today), t = totals(i), any = !!busy;
  const { t: tr } = useT();
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
        <span className="num">{euro(t.gross)} · <span className={v === "overdue" ? "warn" : "muted"}>{tr(LABEL[v])}{v === "overdue" ? ` ${daysLate(i, today)} ${tr("mny.d")}` : v === "paid" && i.paidAt ? ` ${i.paidAt}` : ` · ${tr("invp.due", { d: i.due })}`}</span></span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          <p className="muted">{tr(i.source.kind === "negotiation" ? "invp.fromNeg" : "invp.fromBiz", { label: i.source.label })} · {tr("invp.ref", { ref: i.ref })}{i.reminded.length ? ` · ${tr("invp.reminded", { n: i.reminded.length, last: i.reminded.at(-1)!.at.slice(0, 10) })}` : ""}</p>
          {i.status === "draft" ? (
            <div className="space-y-1">
              <div className="grid gap-1 sm:grid-cols-2">
                {(["name", "regCode", "vatNo", "address", "email"] as const).map((k) => <input key={k} className="field" aria-label={tr(BUYER[k])} placeholder={tr(BUYER[k])} value={f.buyer[k]} onChange={(e) => setF({ ...f, buyer: { ...f.buyer, [k]: e.target.value } })} />)}
              </div>
              {f.lines.map((l, k) => (
                <div key={k} className="flex gap-1">
                  <input className="field flex-1" aria-label={tr("invp.desc")} value={l.text} onChange={(e) => line(k, "text", e.target.value)} />
                  <input className="field w-14" aria-label={tr("invp.qty")} inputMode="decimal" value={l.qty} onChange={(e) => line(k, "qty", e.target.value)} />
                  <input className="field w-20" aria-label={tr("invp.unit")} inputMode="decimal" value={l.price} onChange={(e) => line(k, "price", e.target.value)} />
                  <button className="chip" aria-label={tr("invp.removeLine")} disabled={f.lines.length < 2} onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== k) })}>✕</button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <button className="chip" onClick={() => setF({ ...f, lines: [...f.lines, { text: "", qty: "1", price: "" }] })}>+ {tr("invp.line")}</button>
                <label className="flex items-center gap-1"><input type="checkbox" checked={f.vatOn} onChange={(e) => setF({ ...f, vatOn: e.target.checked })} />{tr("mny.vat")}</label>
                <label className="flex items-center gap-1"><span className="muted">{tr("invp.rate")}</span><input className="field w-12" inputMode="decimal" value={f.vatRate} onChange={(e) => setF({ ...f, vatRate: e.target.value })} /></label>
                <label className="flex items-center gap-1"><span className="muted">{tr("mny.date")}</span><input className="field" type="date" value={f.issued} onChange={(e) => setF({ ...f, issued: e.target.value })} /></label>
                <label className="flex items-center gap-1"><span className="muted">{tr("invp.dueLabel")}</span><input className="field" type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
              </div>
              <textarea className="field w-full" rows={2} placeholder={tr("invp.notePh")} maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
              <p className="muted num">{tr("invp.net")} {euro(t.net)}{i.vat.on ? ` · ${tr("mny.vat")} ${i.vat.rate}% ${euro(t.vat)}` : ` · ${tr("invp.noVat")}`} · {tr("invp.total")} {euro(t.gross)} ({tr("invp.savedValues")})</p>
              <div className="flex flex-wrap gap-1.5">
                <button className="chip" disabled={any} onClick={() => void act(`edit:${i.id}`, { action: "edit", id: i.id, ...f, vatRate: f.vatRate })}>{tr("chats.save")}</button>
                <a className="chip" href={`/api/business/invoices?pdf=${i.id}`}>PDF</a>
                <button className="chip" disabled={any} onClick={() => void act(`sent:${i.id}`, { action: "status", id: i.id, to: "sent" })}>{tr("invp.iSent")}</button>
                <button className="chip" disabled={any} onClick={async () => (await askConfirm(tr("invp.delConfirm", { n: i.number }))) && void act(`del:${i.id}`, { action: "delete", id: i.id })}>{tr("invp.delDraft")}</button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <ul>{i.lines.map((l, k) => <li key={k} className="num">{l.text} · {l.qty} × {euro(l.cents)} = {euro(t.lines[k])}</li>)}</ul>
              <div className="flex flex-wrap items-center gap-1.5">
                <a className="chip" href={`/api/business/invoices?pdf=${i.id}`}>PDF</a>
                {i.status === "sent" && <>
                  <input className="field" type="date" aria-label={tr("invp.paidOn")} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                  <button className="chip" disabled={any} onClick={() => void act(`paid:${i.id}`, { action: "status", id: i.id, to: "paid", paidOn })}>{tr("invp.markPaid")}</button>
                  {!i.reminded.length && <button className="chip" disabled={any} onClick={() => void act(`draft:${i.id}`, { action: "status", id: i.id, to: "draft" })}>{tr("invp.backDraft")}</button>}
                </>}
                {i.status === "paid" && !i.refunds?.length && <button className="chip" disabled={any} onClick={() => void act(`unpaid:${i.id}`, { action: "status", id: i.id, to: "sent" })}>{tr("invp.notPaid")}</button>}
              </div>
              {i.status !== "paid" && <PayLink i={i} stripe={stripe} busy={any} act={act} />}
              {i.status === "paid" && <Refunds i={i} today={today} busy={any} act={act} />}
              {v === "overdue" && !i.reminder && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <select className="chip" aria-label={tr("invp.remLang")} value={lang} onChange={(e) => setLang(e.target.value)}>{REMIND_LANGS.map((l) => <option key={l}>{l}</option>)}</select>
                  <button className="chip" disabled={any} onClick={() => void act(`remind:${i.id}`, { action: "remind", id: i.id, lang })}>{tr("invp.draftRem")}</button>
                </div>
              )}
              {i.reminder && (
                <div className="space-y-1 rounded-md border border-amber-400/40 p-2">
                  <p><b>{i.reminder.subject}</b> → {reminderContent(i).to || tr("invp.noEmail")}</p>
                  <p className="whitespace-pre-wrap">{i.reminder.text}</p>
                  <div className="flex gap-1.5">
                    <button className={`chip ${sure ? "ok" : ""}`} disabled={any}
                      onClick={() => (sure ? (setSure(false), void contentHash(reminderContent(i)).then((seen) => act(`approve:${i.id}`, { action: "approve", id: i.id, seen }, (j) => j.text && setCopy(j.text)))) : (setSure(true), setTimeout(() => setSure(false), 5000)))}>
                      {busy === `approve:${i.id}` ? "…" : sure ? tr("invp.again") : `✓ ${tr("common.approve")}`}</button>
                    <button className="chip" disabled={any} onClick={() => void act(`drop:${i.id}`, { action: "drop", id: i.id })}>{tr("invp.discard")}</button>
                  </div>
                </div>
              )}
              {copy && <div className="space-y-1"><p className="whitespace-pre-wrap">{copy}</p><button className="chip" onClick={() => void navigator.clipboard?.writeText(copy)}>{tr("common.copy")}</button></div>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** BUS06: money he paid back on a paid invoice, kept on its own day (Money, CSV and digests count it apart from "paid"). */
function PayLink({ i, stripe, busy, act }: { i: Invoice; stripe?: boolean; busy: boolean; act: Act }) {
  const { t } = useT();
  const [url, setUrl] = useState(i.payUrl ?? "");
  useEffect(() => setUrl(i.payUrl ?? ""), [i.payUrl]);
  return (
    <div className="flex flex-wrap items-center gap-1.5" title={t("inv.payHint")}>
      <input className="field w-64" type="url" aria-label={t("inv.pay")} placeholder={t("inv.pay")} maxLength={500} value={url} onChange={(e) => setUrl(e.target.value)} />
      <button className="chip" disabled={busy || url === (i.payUrl ?? "")} onClick={() => void act(`pay:${i.id}`, { action: "paylink", id: i.id, url })}>{t("inv.paySave")}</button>
      {stripe && !i.payUrl && <button className="chip" disabled={busy} onClick={() => void act(`stripe:${i.id}`, { action: "stripelink", id: i.id })}>{t("inv.payStripe")}</button>}
    </div>
  );
}

function Refunds({ i, today, busy, act }: { i: Invoice; today: string; busy: boolean; act: Act }) {
  const { t } = useT();
  const [f, setF] = useState({ amount: "", day: today, note: "" });
  const left = totals(i).gross - refunded(i);
  return (
    <div className="space-y-1">
      {(i.refunds ?? []).map((r, k) => <p key={k} className="num">{t("inv.refunded", { x: euro(r.cents), d: r.day })}{r.note && <span className="muted"> · {r.note}</span>}</p>)}
      <div className="flex flex-wrap items-center gap-1.5">
        {left > 0 && <>
          <input className="field w-28" inputMode="decimal" aria-label={t("inv.refundAmount")} placeholder={t("inv.refundAmount")} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <input className="field" type="date" aria-label={t("inv.refundDay")} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />
          <input className="field w-40" aria-label={t("inv.refundNote")} placeholder={t("inv.refundNote")} maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <button className="chip" disabled={busy || !f.amount.trim()} onClick={() => void act(`refund:${i.id}`, { action: "refund", id: i.id, ...f }, () => setF({ amount: "", day: today, note: "" }))}>{t("inv.refund")}</button>
        </>}
        {!!i.refunds?.length && <button className="chip" disabled={busy} onClick={() => void act(`unrefund:${i.id}`, { action: "unrefund", id: i.id })}>{t("inv.unrefund")}</button>}
      </div>
    </div>
  );
}

function form(i: Invoice) {
  return {
    buyer: { ...i.buyer }, lines: i.lines.map((l) => ({ text: l.text, qty: String(l.qty), price: (l.cents / 100).toFixed(2) })),
    vatOn: i.vat.on, vatRate: String(i.vat.rate), issued: i.issued, due: i.due, notes: i.notes,
  };
}
