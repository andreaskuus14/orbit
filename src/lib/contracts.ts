// BUSINESS → Contracts store and actions (rules: contracts-pure.ts). <ORBIT data dir>/contracts.json; signed PDFs go to VAULT.
// ORBIT drafts only on his click (autonomy area "contracts": Off/Ask). Signing, sending and "countersigned" each need his own click
// in the PC's BUSINESS drawer; there is no phone, voice or auto path to any of them (AGENTS.md rule 6). Ledger: ids only.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, emit, recordUsage, MODEL } from "./claude";
import { orbitDataDir } from "./data-dir";
import { stopAllOn } from "./stop-all";
import { usageHold } from "./usage-meter";
import { allows } from "./autonomy";
import { pushNotify } from "./remote-push";
import { emailIn } from "./business-pure";
import { approvalGate } from "./approval-pure";
import {
  FILL_SYSTEM, STATUSES, contractText, MAX_COMMENTS, MAX_CONTRACTS, MAX_VERSIONS, TEMPLATES, cleanFields, contractPdf, coverEmail, coverSubject, current, fillPrompt, isTemplateId,
  makeVersion, mergeFields, missing, overridesOf, parseFill, parseSignature, sha256Hex, transition, waitingIds,
  type Contract, type Event, type Fields, type Override, type Status,
  contractSendContent,
} from "./contracts-pure";

export class ContractError extends Error { status: number; constructor(m: string, status = 400) { super(m); this.status = status; } }
const FILE = () => path.join(orbitDataDir(), "contracts.json");
const g = globalThis as unknown as { __orbitContracts?: Promise<unknown> };

async function load(): Promise<Contract[]> {
  try { const j = JSON.parse(await readFile(FILE(), "utf8")); if (!Array.isArray(j?.contracts)) throw new Error("contracts.json is unreadable"); return j.contracts; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; } // a broken file throws instead of wiping his contracts
}
/** Read-modify-write, one at a time, saved atomically. fn throws ContractError to refuse (nothing changes). */
function update<T>(fn: (list: Contract[]) => T | Promise<T>): Promise<T> {
  const p = (g.__orbitContracts ?? Promise.resolve()).catch(() => {}).then(async () => {
    const list = await load(), out = await fn(list);
    await mkdir(path.dirname(FILE()), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify({ contracts: list }));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  g.__orbitContracts = p;
  return p;
}
const find = (list: Contract[], id: unknown) => { const c = list.find((x) => x.id === id); if (!c) throw new ContractError("Contract not found", 404); return c; };
const step = (c: Contract, ev: Event, complete = true): Status => { const to = transition(c.status, ev, "owner", complete); if (!(STATUSES as readonly string[]).includes(to)) throw new ContractError(to, 409); return to as Status; };
const ledger = (sb: SupabaseClient, uid: string, c: Contract) => emit(sb, uid, "contract.status", "business", { contractId: c.id, to: c.status, version: current(c).n });
const gate = () => { const a = allows("contracts", "owner"); if (!a.ok) throw new ContractError(a.why, 503); };
const setStatus = (c: Contract, to: Status, now: string) => { c.status = to; c.updatedAt = now; if (to === "review") c.reviewAt = now; };

export const listContracts = () => load();
/** Contract ids waiting for his signature for 2 h+ (the call's "contract" reason). */
export const waitingContracts = async (now = Date.now()) => waitingIds(await load(), now);

type Source = { kind: "prospect" | "deal"; id: string };
/** What ORBIT knows about the source: prefilled fields, the model's context (data, not instructions) and a label. */
async function fromSource(sb: SupabaseClient, s: Source): Promise<{ fields: Fields; context: Record<string, unknown>; label: string }> {
  if (s.kind === "prospect") {
    const { data: p, error } = await sb.from("prospects").select("name, kind, contact, notes, fee").eq("id", s.id).maybeSingle();
    if (error) throw new ContractError(error.message, 500);
    if (!p) throw new ContractError("Prospect not found", 404);
    return { fields: { partyName: p.name, ...(emailIn(p.contact ?? "") && { partyEmail: emailIn(p.contact ?? "")! }) }, context: { business: p }, label: p.name };
  }
  const board = await (await import("./deals")).dealBoard();
  const o = Object.values(board.offers).flat().find((x) => x.id === s.id);
  if (!o) throw new ContractError("Deal not found (dismissed or expired?)", 404);
  return {
    fields: { ownerRole: "Buyer", partyName: o.seller || "", scope: `${o.title}${o.condition !== "unknown" ? ` (${o.condition})` : ""}, as listed at ${o.url}`, price: String(o.price), currency: o.currency },
    context: { offer: { title: o.title, price: o.price, currency: o.currency, condition: o.condition, seller: o.seller, site: o.site } }, label: o.seller || o.site,
  };
}

/** His "New contract": his fields + the source's, then (ai) ORBIT fills only the blanks and may suggest clause wording. */
export async function createContract(sb: SupabaseClient, userId: string, b: Record<string, unknown>, signal?: AbortSignal): Promise<Contract> {
  gate();
  if (!isTemplateId(b.template)) throw new ContractError("Pick a template");
  const t = TEMPLATES[b.template];
  const src = b.source && typeof b.source === "object" ? (b.source as Source) : null;
  if (src && (!["prospect", "deal"].includes(src.kind) || typeof src.id !== "string" || src.id.length > 128)) throw new ContractError("Unknown source");
  const known = src ? await fromSource(sb, src) : { fields: {}, context: {}, label: "" };
  let fields = mergeFields(cleanFields(t, known.fields), cleanFields(t, b.fields, false));
  let overrides: Record<string, Override> = {}, by: "owner" | "orbit" = "owner";
  if (b.ai === true) {
    const held = stopAllOn() ? "Stop-all is on" : usageHold();
    if (held) throw new ContractError(`Not drafting right now: ${held}`, 503);
    const r = await askClaude(fillPrompt(t, fields, known.context), FILL_SYSTEM, { lane: "foreground", purpose: "business.contract", timeoutMs: 120_000, signal });
    void recordUsage(sb, userId, "business.contract", r, MODEL);
    const fill = parseFill(t, r.text);
    fields = mergeFields(fields, fill.fields); overrides = fill.overrides; by = "orbit";
  }
  const now = new Date().toISOString(), title = (typeof b.title === "string" && b.title.trim().slice(0, 120)) || t.title;
  const v = await makeVersion(t, title, fields, overrides, 1, by, now);
  const status: Status = missing(t, fields).length ? "draft" : "review";
  const c: Contract = { id: randomUUID(), title, template: t.id, status, at: now, updatedAt: now, ...(status === "review" && { reviewAt: now }),
    ...(src && { source: { ...src, label: known.label.slice(0, 120) } }), versions: [v], comments: [], cover: coverEmail({ title }, fields) };
  await update((list) => { if (list.filter((x) => x.status !== "cancelled").length >= MAX_CONTRACTS) throw new ContractError("Too many contracts: cancel old ones first"); list.unshift(c); });
  void ledger(sb, userId, c);
  if (status === "review" && by === "orbit") pushNotify("contract"); // label only: "a contract waits for your signature"
  return c;
}

/** His edit: fields and clause texts (null = back to the template). seen: the hash he was looking at. Makes a new version. */
export async function editContract(sb: SupabaseClient, userId: string, id: unknown, b: Record<string, unknown>): Promise<Contract> {
  gate();
  const c = await update(async (list) => {
    const c = find(list, id), v = current(c), t = TEMPLATES[c.template];
    if (b.seen !== v.hash) throw new ContractError("It changed since you opened it: reload and check it again", 409);
    const fields = b.fields === undefined ? v.fields : mergeFields(cleanFields(t, {}, true), cleanFields(t, b.fields, false));
    const overrides = overridesOf(v);
    if (b.clauses && typeof b.clauses === "object") for (const [k, x] of Object.entries(b.clauses as Record<string, unknown>)) {
      if (!t.clauses.some((cl) => cl.id === k)) continue;
      if (x === null) delete overrides[k]; else if (typeof x === "string") overrides[k] = { text: x, by: "owner" };
    }
    const to = step(c, "edit", !missing(t, fields).length);
    const now = new Date().toISOString(), next = await makeVersion(t, c.title, fields, overrides, v.n + 1, "owner", now);
    if (next.hash === v.hash) return c;
    c.versions = [...c.versions, next].slice(-MAX_VERSIONS);
    if (c.cover === coverEmail(c, v.fields)) c.cover = coverEmail(c, fields); // an untouched cover follows the names
    setStatus(c, to, now);
    return c;
  });
  void ledger(sb, userId, c);
  return c;
}

export const addComment = (id: unknown, text: unknown) => update((list) => {
  const c = find(list, id), t = typeof text === "string" ? text.trim().slice(0, 1000) : "";
  if (!t) throw new ContractError("Write a comment");
  c.comments = [...c.comments, { at: new Date().toISOString(), n: current(c).n, text: t }].slice(-MAX_COMMENTS);
  return c;
});

export const setCover = (id: unknown, text: unknown) => update((list) => {
  const c = find(list, id);
  if (c.status === "sent" || c.status === "countersigned") throw new ContractError("Already sent");
  c.cover = typeof text === "string" ? text.replace(/\r/g, "").slice(0, 4000) : c.cover; c.updatedAt = new Date().toISOString();
  return c;
});

/** HIS signature, from his click on Sign: only the exact version he read (seen = its hash). Makes the PDF and stores it in VAULT. */
export async function signContract(sb: SupabaseClient, userId: string, id: unknown, seen: unknown, signature: unknown): Promise<Contract> {
  gate();
  const sig = parseSignature(signature);
  if (typeof sig === "string") throw new ContractError(sig);
  const c = await update(async (list) => {
    const c = find(list, id), v = current(c);
    if (seen !== v.hash) throw new ContractError("The contract changed since you read it: read it again before signing", 409);
    const to = step(c, "sign");
    const at = new Date().toISOString(), t = TEMPLATES[c.template];
    if (await sha256Hex(contractText(t, c.title, v.fields, v.clauses)) !== v.hash) throw new ContractError("This version's text doesn't match its fingerprint: edit it once to make a fresh version", 409);
    const pdf = contractPdf(t, c, v, sig, at);
    const { saveUpload, listVault } = await import("./vault");
    const name = await saveUpload(new File([pdf as BlobPart], `${c.title} - ${v.fields.partyName ?? ""} - v${v.n} signed ${at.slice(0, 10)}.pdf`, { type: "application/pdf" }), { taken: (await listVault()).map((f) => f.name) });
    c.signed = { n: v.n, hash: v.hash, at, kind: sig.kind, pdf: name, pdfSha: await sha256Hex(pdf) };
    setStatus(c, to, at);
    return c;
  });
  void ledger(sb, userId, c);
  return c;
}

/** Owner-only status steps: take the signature back (the PDF stays in VAULT), mark countersigned, cancel. */
export async function ownerStep(sb: SupabaseClient, userId: string, id: unknown, ev: "unsign" | "countersign" | "cancel", note?: unknown): Promise<Contract> {
  const c = await update((list) => {
    const c = find(list, id), to = step(c, ev), now = new Date().toISOString();
    if (ev === "unsign") delete c.signed;
    if (ev === "countersign") c.countersigned = { at: now, note: typeof note === "string" ? note.trim().slice(0, 300) : "" };
    setStatus(c, to, now);
    return c;
  });
  void ledger(sb, userId, c);
  return c;
}

/** "Approve & send": emails the signed PDF with his cover text to the counterparty, only from his click on the exact cover he read
 *  (seen = contentHash of contractSendContent: recipient, subject, cover text and the signed PDF's hash). Same guards as BUSINESS sendDraft: Resend set up, Stop-all off, BUSINESS email and Contracts not Off, claimed first. */
export async function sendContract(sb: SupabaseClient, userId: string, id: unknown, seen: unknown): Promise<Contract> {
  const key = process.env.RESEND_API_KEY, from = process.env.ORBIT_MAIL_FROM;
  if (!key || !from) throw new ContractError("Sending isn't set up: add RESEND_API_KEY and ORBIT_MAIL_FROM to .env.local, or download the PDF and email it yourself", 503);
  if (stopAllOn()) throw new ContractError("Not sending: Stop-all is on", 503);
  for (const a of ["business-send", "contracts"] as const) { const v = allows(a, "owner"); if (!v.ok) throw new ContractError(`Not sending: ${v.why}`, 503); }
  const stamp = new Date().toISOString();
  const c = await update(async (list) => { // claim signed → sent first: one email even on a double click
    const c = find(list, id);
    const gate = await approvalGate("contracts.send", seen, contractSendContent(c));
    if (gate) throw new ContractError(gate, 409);
    if (!c.signed || c.signed.hash !== current(c).hash) throw new ContractError("Sign this version first", 409);
    const to = emailIn(current(c).fields.partyEmail ?? "");
    if (!to) throw new ContractError("Put the other party's email address in the contract first");
    if (!c.cover.trim()) throw new ContractError("Write the email first");
    setStatus(c, step(c, "send"), stamp); c.sent = { at: stamp, to };
    return structuredClone(c);
  });
  const settle = (fn: (c: Contract) => void) => update((list) => { const x = find(list, c.id); fn(x); return x; });
  const { readStream } = await import("./vault");
  const pdf = Buffer.from(await new Response((await readStream(c.signed!.pdf, null)).stream).arrayBuffer());
  let r: Response;
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "Idempotency-Key": `orbit-contract-${c.id}-${c.signed!.hash.slice(0, 16)}` },
      body: JSON.stringify({ from, to: c.sent!.to, subject: coverSubject(c, current(c).fields), text: c.cover, attachments: [{ filename: c.signed!.pdf, content: pdf.toString("base64") }],
        ...(process.env.ORBIT_MAIL_REPLY_TO ? { reply_to: process.env.ORBIT_MAIL_REPLY_TO } : {}) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    await settle((x) => { x.sent = { ...x.sent!, note: "No answer from Resend: it may or may not have gone out. Check your Resend log." }; });
    throw new ContractError("No answer from the email service: it may or may not have been sent. Check your Resend log; it stays marked Sent.", 504);
  }
  if (r.status >= 500 || r.status === 429) {
    await settle((x) => { x.sent = { ...x.sent!, note: `Resend ${r.status}: result unknown. Check your Resend log.` }; });
    throw new ContractError(`The email service had a problem (${r.status}): it may or may not have been sent. It stays marked Sent.`, 502);
  }
  if (!r.ok) { // a clear refusal: nothing went out
    await settle((x) => { if (x.status === "sent") { x.status = "signed"; delete x.sent; } });
    throw new ContractError(`Not sent: Resend ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`, 502);
  }
  void ledger(sb, userId, c);
  return c;
}
