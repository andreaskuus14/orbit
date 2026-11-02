import { authorizeApproval } from "./authority";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./claude";
import { orbitDataDir } from "./data-dir";
import { stopAllOn } from "./stop-all";
import { allows } from "./autonomy";
import { emailIn } from "./business-pure";
import { resendMail } from "./business-send";
import { localDay } from "./morning-pure";
import {
  approveProblem, reminderContent, dashboard, invoicePushes, editInvoice, invoicePdf, newInvoice, parseSeller, readyProblem, reminderDraft, setStatus, addRefund, dropRefund,
  type From, type Invoice, type Seller,
} from "./invoices-pure";

// Invoices store and IO (rules: invoices-pure.ts): <ORBIT data dir>/invoices.json with his seller details and the invoices.
// He sends the invoice PDF himself and marks it sent/paid; ORBIT only drafts reminders, which go out on his approve click
// (Resend when the buyer has one email address, otherwise he copies it). The ledger gets invoice ids and statuses only.

type Store = { seller: Seller | null; invoices: Invoice[] };
const FILE = () => path.join(orbitDataDir(), "invoices.json");
const g = globalThis as unknown as { __orbitInvoices?: { write: Promise<unknown> } };
const S = (g.__orbitInvoices ??= { write: Promise.resolve() });
const today = () => localDay(new Date());

async function load(): Promise<Store> {
  let raw: string;
  try { raw = await readFile(FILE(), "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { seller: null, invoices: [] };
    throw e;
  }
  const s = JSON.parse(raw) as Store; // a broken file throws instead of wiping his invoices
  if (!s || !Array.isArray(s.invoices)) throw new Error("invoices.json is unreadable");
  return s;
}
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = S.write.catch(() => {}).then(async () => {
    const s = await load(), out = fn(s);
    await mkdir(path.dirname(FILE()), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify(s, null, 1));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  S.write = p;
  return p;
}
const put = (s: Store, i: Invoice) => { s.invoices = [...s.invoices.filter((x) => x.id !== i.id), i]; };
/** Apply fn to one invoice; a string from fn is an error for the caller. */
const change = (id: unknown, fn: (i: Invoice, s: Store) => Invoice | string) => update((s) => {
  const i = s.invoices.find((x) => x.id === id);
  if (!i) return "Not found";
  const next = fn(i, s);
  if (typeof next !== "string") put(s, next);
  return next;
});

export async function invoicesView() {
  const s = await load(), day = today();
  return { seller: s.seller, invoices: [...s.invoices].sort((a, b) => b.created.localeCompare(a.created)), dashboard: dashboard(s.invoices, day), today: day };
}
/** For the morning brief / night report; never throws. */
export const allInvoices = () => load().then((s) => s.invoices, () => [] as Invoice[]);

export const saveSeller = (b: Record<string, unknown>) => update((s) => { const r = parseSeller(b); if (typeof r === "string") return r; s.seller = r; return r; });

/** A draft from a BUSINESS prospect (its fee) or an agreed sell-side negotiation (its agreed price). */
export async function createFrom(sb: SupabaseClient, userId: string, b: Record<string, unknown>): Promise<Invoice | string> {
  let prospectId: string, price: number | null = null, source: From["source"];
  if (b.from === "negotiation") {
    const { listNegotiations } = await import("./negotiator");
    const n = (await listNegotiations()).find((x) => x.id === b.id);
    if (!n) return "Not found";
    if (n.side !== "sell" || n.state !== "agreed") return "Only an agreed BUSINESS negotiation can be invoiced";
    price = [...n.turns].reverse().find((t) => t.price !== null)?.price ?? null;
    prospectId = n.ref.slice(9);
    source = { kind: "negotiation", id: n.id, label: n.title };
  } else if (b.from === "prospect" && typeof b.id === "string") {
    prospectId = b.id;
    source = { kind: "prospect", id: b.id, label: "" };
  } else return "from must be prospect or negotiation";
  const { data: p, error } = await sb.from("prospects").select("name, kind, contact, fee").eq("id", prospectId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) return "Prospect not found";
  if (!source.label) source.label = p.name;
  const cents = Math.round((price ?? (Number(p.fee) || 0)) * 100);
  const made = await update((s) => {
    const i = newInvoice(randomUUID(), { source, buyer: { name: p.name, email: emailIn(p.contact ?? "") ?? "" }, line: { text: p.kind ? `${p.kind}: services as agreed` : "Services as agreed", cents } }, s.seller, s.invoices.map((x) => x.number), Date.now());
    put(s, i);
    return i;
  });
  void emit(sb, userId, "invoice.status", "business", { invoice: made.id, to: "draft" });
  return made;
}

export const editDraft = (b: Record<string, unknown>) => change(b.id, (i) => editInvoice(i, b, Date.now()));
export const deleteDraft = (id: unknown) => update((s) => {
  const i = s.invoices.find((x) => x.id === id);
  if (!i) return "Not found";
  if (i.status !== "draft") return "Only a draft can be deleted: a sent invoice stays on record";
  s.invoices = s.invoices.filter((x) => x.id !== id);
  return "";
});

export async function changeStatus(sb: SupabaseClient, userId: string, b: Record<string, unknown>) {
  const r = await change(b.id, (i, s) => setStatus(i, b.to, Date.now(), s.seller, b.paidOn));
  if (typeof r !== "string") void emit(sb, userId, "invoice.status", "business", { invoice: r.id, to: r.status });
  return r;
}

/** His refund record on a paid invoice (BUS06): {action:"refund", id, amount, day?, note?} or {action:"unrefund", id}. Nothing is paid by ORBIT. */
export const refundInvoice = (b: Record<string, unknown>) => change(b.id, (i) => (b.action === "unrefund" ? dropRefund(i, Date.now()) : addRefund(i, b, Date.now())));

export const draftReminder = (b: Record<string, unknown>) => change(b.id, (i, s) => {
  const r = reminderDraft(i, s.seller, b.lang, today(), Date.now());
  return typeof r === "string" ? r : { ...i, reminder: r, updated: r.at };
});
export const dropReminder = (id: unknown) => change(id, (i) => ({ ...i, reminder: null }));

/** The PDF, once the Estonian basics are there. */
export async function pdfOf(id: unknown): Promise<{ file: Uint8Array; name: string } | string> {
  const s = await load(), i = s.invoices.find((x) => x.id === id);
  if (!i) return "Not found";
  const why = readyProblem(i, s.seller);
  if (why) return why;
  return { file: invoicePdf(i, s.seller!), name: `invoice-${i.number}.pdf` };
}

/** Scheduler tick: push "Invoice X is N days overdue — a reminder is ready" for waiting drafts, once per invoice per week.
 *  Stamped before sending so a crash can't repeat it; skipped (not stamped) in quiet hours or Stop-all. Never throws. */
export async function pushInvoiceReminders(now = Date.now()) {
  try {
    const { canNotify, deliver } = await import("./remote-push"), { quietAt } = await import("./remote-push-pure");
    if (stopAllOn() || !canNotify() || quietAt(now)) return; // Web Push or ntfy
    const day = localDay(new Date(now)), due = invoicePushes((await load()).invoices, day, now);
    if (!due.length) return;
    const at = new Date(now).toISOString();
    const stamped = await update((s) => due.filter((p) => { const i = s.invoices.find((x) => x.id === p.id); if (i) put(s, { ...i, pushedAt: at }); return !!i; }));
    for (const p of stamped) void deliver({ title: p.title, body: p.body, url: "/remote#r-appr", tag: "invoice" });
  } catch (e) { console.error("[orbit] invoice push:", e instanceof Error ? e.message : e); }
}

const fail = (error: string, status = 400) => Response.json({ error }, { status });

/** His approve click on a reminder draft (`seen` = contentHash of reminderContent, the exact email he read). Emails the buyer through the BUSINESS send path
 *  when Resend is set up and the buyer has an email; otherwise it is recorded as approved for him to copy. Never automatic. */
export async function approveReminder(sb: SupabaseClient, userId: string, id: unknown, seen: unknown): Promise<Response> {
  if (stopAllOn()) return fail("Not now: Stop-all is on", 503);
  const day = today(), s0 = await load(), i0 = s0.invoices.find((x) => x.id === id);
  const why = approveProblem(i0, day) || (await authorizeApproval("invoices.remind", seen, reminderContent(i0!)));
  if (why || !i0) return fail(why, why === "Not found" ? 404 : 409);
  const to = process.env.RESEND_API_KEY && process.env.ORBIT_MAIL_FROM ? emailIn(i0.buyer.email) : null;
  if (to) { const a = allows("business-send", "owner"); if (!a.ok) return fail(`Not sending: ${a.why}`, 503); }
  const draft = i0.reminder!;
  // Claim first (the draft leaves the store), so a double tap can't send twice.
  const claimed = await update((s) => {
    const cur = s.invoices.find((x) => x.id === i0.id);
    if (approveProblem(cur, day) || cur!.reminder!.at !== draft.at) return null; // same version the gate just hashed
    const next = { ...cur!, reminder: null, reminded: [...cur!.reminded, { at: new Date().toISOString(), via: to ? ("unknown" as const) : ("copy" as const) }], updated: new Date().toISOString() };
    put(s, next);
    return next;
  });
  if (!claimed) return fail("The reminder changed since you read it: reload", 409);
  const settle = (via: "email" | "copy" | "unknown") => update((s) => {
    const cur = s.invoices.find((x) => x.id === i0.id)!;
    const next = { ...cur, reminded: cur.reminded.map((r, k) => (k === cur.reminded.length - 1 ? { ...r, via } : r)) };
    put(s, next);
    void emit(sb, userId, "invoice.reminder", "business", { invoice: next.id, via });
    return next;
  });
  if (!to) { const inv = await settle("copy"); return Response.json({ ok: true, invoice: inv, text: draft.text, message: "Approved: copy it and send it yourself." }); }
  const r = await resendMail({ to, subject: draft.subject, text: draft.text, idempotencyKey: `orbit-invoice-${i0.id}-${draft.at}` });
  if (r.result === "unknown") { await settle("unknown"); return fail(`The email service didn't confirm (${r.why}): it may or may not have been sent. Check your Resend log.`, 502); }
  if (r.result === "refused") { const inv = await settle("copy"); return Response.json({ ok: true, invoice: inv, text: draft.text, message: `Email refused (${r.why}): copy it and send it yourself.` }); }
  const inv = await settle("email");
  return Response.json({ ok: true, invoice: inv, message: `Reminder sent to ${to}.` });
}
