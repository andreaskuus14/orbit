import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, emit } from "./claude";
import { orbitDataDir } from "./data-dir";
import { stopAllOn } from "./stop-all";
import { usageHold } from "./usage-meter";
import { allows } from "./autonomy";
import { emailIn, sendSubject, LANGS } from "./business-pure";
import {
  NEGO_SYSTEM, addReply, applyApproval, approveProblem, editDraft, makeDraft, negoPrompt, newNegotiation, parseLimits, replan, refSide, waiting,
  type Negotiation, type Plan, type Turn,
} from "./negotiator-pure";

// Negotiator store and IO (rules: negotiator-pure.ts): <ORBIT data dir>/negotiations.json, one negotiation per prospect/offer ref.
// Their replies come from what he pastes in BUSINESS / Deals (no inbox login). CORE only words a plan already inside his limits.
// Approve = his click: a BUSINESS prospect with one email address is emailed through Resend; anything else he copies and sends himself.
// The ledger gets ids, intents and states only ("nego.step"), never text or prices.

type Store = { negotiations: Negotiation[] };
const FILE = () => path.join(orbitDataDir(), "negotiations.json");
const g = globalThis as unknown as { __orbitNego?: { write: Promise<unknown> } };
const S = (g.__orbitNego ??= { write: Promise.resolve() });

async function load(): Promise<Store> {
  let raw: string;
  try { raw = await readFile(FILE(), "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { negotiations: [] };
    throw e;
  }
  const s = JSON.parse(raw) as Store; // a broken file throws instead of wiping his negotiations
  if (!s || !Array.isArray(s.negotiations)) throw new Error("negotiations.json is unreadable");
  return s;
}
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = S.write.catch(() => {}).then(async () => {
    const s = await load(), out = fn(s);
    await mkdir(path.dirname(FILE()), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify(s));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  S.write = p;
  return p;
}
const put = (s: Store, n: Negotiation) => { s.negotiations = [...s.negotiations.filter((x) => x.id !== n.id), n]; };

export const listNegotiations = async () => (await load()).negotiations;
/** Drafts he can approve now: BUSINESS, the morning brief and the phone list these. */
export const waitingNegotiations = async () => waiting((await load().catch((): Store => ({ negotiations: [] }))).negotiations);

const step = (sb: SupabaseClient, userId: string, n: Negotiation, intent?: string) =>
  emit(sb, userId, "nego.step", n.side === "sell" ? "business" : "markets", { nego: n.id, ...(intent && { intent }), state: n.state });

/** Start (or update the limits of) the negotiation for a prospect/offer. */
export async function setLimits(b: Record<string, unknown>): Promise<Negotiation | string> {
  if (!refSide(b.ref)) return "Unknown item";
  const l = parseLimits(b);
  if (typeof l === "string") return l;
  return update((s) => {
    const old = s.negotiations.find((n) => n.ref === b.ref && n.state === "talking");
    // new limits invalidate a waiting draft: it was planned against the old ones
    const n = old ? { ...old, limits: l, draft: null, updated: new Date().toISOString() } : newNegotiation(randomUUID(), b.ref as string, String(b.title ?? ""), l, Date.now());
    if (typeof n === "string") return n;
    put(s, n);
    return n;
  });
}

/** CORE words the plan; the words are checked against his limits before they are kept. */
async function draftFor(n: Negotiation, plan: Plan, lang: string, signal?: AbortSignal): Promise<Negotiation | string> {
  const held = stopAllOn() ? "Stop-all is on" : usageHold();
  if (held) return `Not drafting right now: ${held}`;
  const r = await askClaude(negoPrompt(n, plan, lang), NEGO_SYSTEM, { lane: "foreground", purpose: "business.negotiate", timeoutMs: 90_000, signal });
  const intent = [...n.turns].reverse().find((t) => t.from === "them")?.intent ?? "interested";
  const d = makeDraft(r.text, plan, intent, n.limits, Date.now());
  if (typeof d === "string") return d;
  return update((s) => {
    const cur = s.negotiations.find((x) => x.id === n.id);
    if (!cur || cur.updated !== n.updated) return "It changed while CORE was writing: reload"; // a reply or new limits arrived meanwhile
    const next = { ...cur, draft: d, updated: d.at };
    put(s, next);
    return next;
  });
}

const langOf = (v: unknown) => ((LANGS as readonly unknown[]).includes(v) ? (v as string) : "English");

/** Their reply pasted by him: recorded, classified, planned, and drafted. */
export async function onReply(sb: SupabaseClient, userId: string, b: Record<string, unknown>, signal?: AbortSignal): Promise<Negotiation | string> {
  const saved = await update((s) => {
    const n = s.negotiations.find((x) => x.id === b.id);
    if (!n) return "Not found";
    const r = addReply(n, b.text, Date.now(), b.intent);
    if (typeof r === "string") return r;
    put(s, r.n);
    return r;
  });
  if (typeof saved === "string") return saved;
  void step(sb, userId, saved.n, saved.n.turns.at(-1)?.intent);
  return draftFor(saved.n, saved.plan, langOf(b.lang), signal);
}

/** A fresh draft for the latest reply (or the opening offer), optionally with the intent he corrected. */
export async function redraft(b: Record<string, unknown>, signal?: AbortSignal): Promise<Negotiation | string> {
  const n = (await load()).negotiations.find((x) => x.id === b.id);
  if (!n) return "Not found";
  if (n.state !== "talking") return "This negotiation is closed";
  let base = n;
  if (b.intent !== undefined) { // his correction is stored on their last turn so approval and the brief see the same intent
    const i = n.turns.map((t) => t.from).lastIndexOf("them");
    if (i >= 0) {
      const fixed = await update((s) => {
        const cur = s.negotiations.find((x) => x.id === n.id);
        if (!cur || cur.updated !== n.updated) return null;
        const turns = cur.turns.map((t, j) => (j === i ? { ...t, intent: b.intent as Turn["intent"] } : t));
        const next = { ...cur, turns, draft: null, updated: new Date().toISOString() };
        put(s, next);
        return next;
      });
      if (!fixed) return "It changed meanwhile: reload";
      base = fixed;
    }
  }
  const plan = replan(base, Date.now(), b.intent);
  if (typeof plan === "string") return plan;
  return draftFor(base, plan, langOf(b.lang), signal);
}

/** His own edit of the draft (outside his limits only with confirm: true). */
export const editNegotiation = (b: Record<string, unknown>) => update((s) => {
  const n = s.negotiations.find((x) => x.id === b.id);
  if (!n) return "Not found";
  if (n.draft?.at !== b.seen) return "The draft changed since you read it: reload";
  const d = editDraft(n, b.text, b.confirm, Date.now());
  if (typeof d === "string") return d;
  const next = { ...n, draft: d, updated: d.at };
  put(s, next);
  return next;
});

/** He closes it himself (deal done elsewhere, lost interest). */
export const closeNegotiation = (sb: SupabaseClient, userId: string, id: unknown, state: "agreed" | "lost" | "walked") => update((s) => {
  const n = s.negotiations.find((x) => x.id === id);
  if (!n) return "Not found";
  const next = { ...n, state, draft: null, updated: new Date().toISOString() };
  put(s, next);
  void step(sb, userId, next);
  return next;
});

/** Contract hand-off: no contracts module on main yet, so an agreement is his to write; this is the one place to wire it in later. */
export const contractNote = (n: Negotiation) => (n.state === "agreed" ? `Agreed at €${[...n.turns].reverse().find((t) => t.price !== null)?.price ?? "?"}: draft the contract in BUSINESS → Contracts.` : "");

const fail = (error: string, status = 400) => Response.json({ error }, { status });

/** His approve click (BUSINESS, morning brief or phone): `seen` must be the draft version he read. Emails a BUSINESS prospect when
 *  Resend is set up and Contact holds one address; otherwise records it as approved for him to copy. Never automatic. */
export async function approveNegotiation(sb: SupabaseClient, userId: string, id: unknown, seen: unknown): Promise<Response> {
  if (stopAllOn()) return fail("Not now: Stop-all is on", 503);
  const n = (await load()).negotiations.find((x) => x.id === id);
  const why = approveProblem(n, seen);
  if (why || !n) return fail(why, why === "Not found" ? 404 : 409);
  let to: string | null = null, subject = "";
  const key = process.env.RESEND_API_KEY, from = process.env.ORBIT_MAIL_FROM;
  if (n.side === "sell" && key && from) {
    const { data: p } = await sb.from("prospects").select("name, contact").eq("id", n.ref.slice(9)).maybeSingle();
    to = p ? emailIn(p.contact ?? "") : null;
    subject = p ? `Re: ${sendSubject(p.name, n.draft!.text)}` : "";
    if (to) { const off = allows("business-send", "owner"); if (!off.ok) return fail(`Not sending: ${off.why}`, 503); }
  }
  // Claim first (the draft leaves the store), so a double tap can't send twice.
  const claimed = await update((s) => {
    const cur = s.negotiations.find((x) => x.id === n.id);
    if (approveProblem(cur, seen)) return null;
    const next = applyApproval(cur!, to ? "unknown" : "copy", Date.now());
    put(s, next);
    return next;
  });
  if (!claimed) return fail("The draft changed since you read it: reload", 409);
  const done = (via: Turn["via"]) => update((s) => {
    const cur = s.negotiations.find((x) => x.id === n.id)!;
    const turns = cur.turns.map((t, i) => (i === cur.turns.length - 1 ? { ...t, via } : t));
    put(s, { ...cur, turns });
    return { ...cur, turns };
  });
  void step(sb, userId, claimed);
  const note = contractNote(claimed);
  if (!to) return Response.json({ ok: true, negotiation: claimed, message: `Approved: copy it and send it yourself.${note ? ` ${note}` : ""}` });
  let r: Response;
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "Idempotency-Key": `orbit-nego-${n.id}-${seen}` },
      body: JSON.stringify({ from, to, subject, text: n.draft!.text, ...(process.env.ORBIT_MAIL_REPLY_TO ? { reply_to: process.env.ORBIT_MAIL_REPLY_TO } : {}) }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch { return fail("No answer from the email service: it may or may not have been sent. Check your Resend log.", 504); }
  if (r.status >= 500 || r.status === 429) return fail(`The email service had a problem (${r.status}): it may or may not have been sent. Check your Resend log.`, 502);
  if (!r.ok) { // a clear refusal: nothing went out, so it is his to copy instead
    const back = await done("copy");
    return Response.json({ ok: true, negotiation: back, message: `Email refused (Resend ${r.status}): marked approved, copy it and send it yourself.` });
  }
  const sent = await done("email");
  return Response.json({ ok: true, negotiation: sent, message: `Sent to ${to}.${note ? ` ${note}` : ""}` });
}
