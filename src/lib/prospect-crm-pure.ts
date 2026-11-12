// BUSINESS client records beyond the prospects row (BUS02/03/04/05): where a business came from, whether its contact was
// checked by the owner, a timeline of what actually happened, and the OPERATIONS delivery project. Stored in the ORBIT data dir
// (prospect-crm.ts) keyed by prospect id, so no migration is needed. Tested in tests/prospect-crm.test.ts.

import type { LeadLoop } from "./lead-loop-pure.ts";

export const SOURCES = ["manual", "web-find", "lead-loop"] as const;
export type Source = (typeof SOURCES)[number];
/** Things that happened. "draft" is ORBIT writing; "sent", "reply", "call" are real contact; "stage" and "note" are bookkeeping. */
export const EVENT_KINDS = ["draft", "sent", "reply", "call", "stage", "note"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type CrmEvent = { at: string; kind: EventKind; text?: string };
export type Crm = { source: Source; verified: boolean; verifiedAt?: string; key: string; events: CrmEvent[]; opsProject?: string;
  /** Why it went to "Not now" (BUS08), his pick: feeds the conversion learning. */ lost?: { reason: LostReason; at: string };
  /** B2 lead loop: no-website proof, demo and pitch stage (lead-loop-pure). Auto never sends to these. */ lead?: LeadLoop };
export const LOST_REASONS = ["no-reply", "price", "timing", "not-a-fit", "went-elsewhere", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export type Store = Record<string, Crm>;
export const MAX_EVENTS = 200;

const GENERIC_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|mail|online|hot|neti|zone|inbox|yandex)\./i;

/** A stable dedupe key: the website/email domain (whole address for free-mail), else phone digits, else the name. */
export function contactKey(contact: string, name: string): string {
  const mail = contact.match(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  if (mail) return GENERIC_MAIL.test(mail[1]) ? `mail:${mail[0].toLowerCase()}` : `dom:${mail[1].toLowerCase().replace(/^www\./, "")}`;
  const url = contact.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?:[/:?#]|\s|$)/i);
  if (url) return `dom:${url[1].toLowerCase()}`;
  const digits = contact.replace(/\D/g, "");
  if (digits.length >= 7) return `tel:${digits.slice(-8)}`; // last 8: "+372 5123 4567" and "51234567" match
  return `name:${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`;
}

/** The id of a prospect already holding this key or name, or null. */
export function duplicateOf(ps: { id: string; name: string; contact: string }[], store: Store, name: string, contact: string): string | null {
  const key = contactKey(contact, name), n = name.trim().toLowerCase();
  return ps.find((p) => (store[p.id]?.key ?? contactKey(p.contact, p.name)) === key || p.name.trim().toLowerCase() === n)?.id ?? null;
}

export const newCrm = (source: Source, name: string, contact: string): Crm => ({ source, verified: source === "manual", key: contactKey(contact, name), events: [] });

/** Append one event (newest last, capped). */
export function addEvent(c: Crm, kind: EventKind, at: string, text?: string): Crm {
  const ev: CrmEvent = text ? { at, kind, text: text.slice(0, 300) } : { at, kind };
  return { ...c, events: [...c.events, ev].slice(-MAX_EVENTS) };
}

/** For follow-up timing: the last real contact (sent/reply/call) and whether they replied after our last send. Null when nothing real is logged. */
export function touch(events: CrmEvent[]): { last: string; replied: boolean } | null {
  const real = events.filter((e) => e.kind === "sent" || e.kind === "reply" || e.kind === "call");
  if (!real.length) return null;
  const last = real.reduce((a, b) => (Date.parse(b.at) > Date.parse(a.at) ? b : a));
  const lastSent = real.filter((e) => e.kind === "sent").reduce<number>((m, e) => Math.max(m, Date.parse(e.at)), -Infinity);
  const replied = real.some((e) => e.kind !== "sent" && Date.parse(e.at) >= lastSent);
  return { last: last.at, replied };
}

/** Lines a draft must not carry unless the timeline shows a real call or reply (BUS04): claimed past contact or tests. */
const CLAIMS: RegExp[] = [
  /\b(as (we )?(discussed|agreed)|we (spoke|talked|met)|our (call|conversation|chat|meeting)|following up on our|last time we)\b/i,
  /\bI (tested|tried|checked|sent a test|measured)\b[^.!?]*\b(response|reply|enquir|inquir|form|time)/i,
  /\b(rääkisime|vestlesime|meie (kõne|vestlus|kohtumine)|nagu (arutasime|kokku leppisime)|testisin|proovisin teie)\b/i,
  /(как мы (обсуждали|договорились)|мы (говорили|созванивались)|я (протестировал|проверил))/i,
];
/** Why this draft can't be sent as is, or "" when fine. */
export function claimProblem(draft: string, events: CrmEvent[]): string {
  if (events.some((e) => e.kind === "reply" || e.kind === "call")) return "";
  const hit = CLAIMS.find((r) => r.test(draft));
  return hit ? `The draft claims earlier contact or a test ("${draft.match(hit)![0]}") but the timeline shows no call or reply: remove it first` : "";
}

/** The OPERATIONS delivery project a newly paying client gets (BUS05). */
/** `agreed`: contracts-pure agreedLine of the version the client accepted (BUS07), so delivery follows that exact revision. */
export function deliveryPlan(p: { name: string; kind: string; fee: number }, agreed?: string): { name: string; description: string } {
  return {
    name: `Deliver: ${p.name}`.slice(0, 120),
    description: [
      `Delivery plan for ${p.name}${p.kind ? ` (${p.kind})` : ""}${p.fee ? `, €${p.fee}/month expected` : ""}. Created when BUSINESS moved it to Paying.`,
      ...(agreed ? [agreed] : []),
      agreed ? "1. Kick-off: walk through the agreed version above; anything new is a new proposal revision." : "1. Kick-off: confirm scope, contacts and their enquiry channels.",
      "2. Set up Lead Follow-up Autopilot (services/lead-followup) for their site.",
      "3. Test with one real enquiry together; they tap Send or Reject.",
      "4. Send the first invoice from BUSINESS → Money.",
      "5. Check in after 2 weeks: replies sent, missed enquiries, changes.",
    ].join("\n"),
  };
}
