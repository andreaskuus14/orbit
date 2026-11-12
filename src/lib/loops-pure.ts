// Open loops (roadmap §8.2, pure, tested in tests/loops.test.ts): unresolved promises, unanswered requests, stalled work and
// missing dependencies found by rules in ORBIT's own records. No model call. IO + store: loops.ts; route: app/api/loops; UI: OpenLoops.tsx
// (a panel in mission control). Journal/LIFE is never an input here.
import type { PanelId } from "./planets";
import { dueFollowups, type Prospect } from "./business-pure.ts";
import type { Commitment } from "./dayplan-pure";
import { SAFE_COMMIT_KINDS } from "./world-pure.ts";

export const DAY = 86_400_000;
export const STALL_DAYS = 7; // goal/mission with no change this long
export const APPROVAL_DAYS = 3; // a draft waiting for his click this long
export const COUNTER_DAYS = 7; // a sent contract the other side hasn't signed
export const CHAT_DAYS = 14; // how far back chats are read
export const SNOOZE_DAYS = 3;
export const MAX_LOOPS = 30;

export type LoopKind = "promise" | "waiting" | "inbox" | "goal" | "mission" | "prospect" | "approval" | "invoice" | "contract";
export type Evidence = { label: string; panel: PanelId; chat?: string }; // chat: the CORE conversation to open
export type Loop = { key: string; kind: LoopKind; title: string; next: string; since: string; evidence: Evidence; origin?: string }; // origin: source kind a task made from it keeps
/** Source kind for "Turn into task": the loop's own origin, else what its kind implies. Unknown stays "loop" (world-pure drops it). */
export const loopOrigin = (l: Loop): string => l.origin ?? ({ goal: "goal", mission: "mission", prospect: "business", approval: "business", invoice: "business", contract: "business" } as Partial<Record<LoopKind, string>>)[l.kind] ?? "loop";
export type LoopAction = "close" | "snooze" | "task";
export type Decided = { action: LoopAction; at: string; until?: string };

export type LoopSources = {
  now: number; today: string; // today: local YYYY-MM-DD
  commitments?: (Pick<Commitment, "id" | "text" | "owner" | "due" | "status" | "at"> & { source?: { kind?: string } })[];
  goals?: { id: string; title: string; status: string; updated_at: string }[];
  missions?: { id: string; objective: string; status: string; updated_at: string }[];
  prospects?: Pick<Prospect, "id" | "name" | "stage" | "updated_at" | "notes" | "draft">[];
  invoices?: { id: string; number: string; buyer: { name: string }; status: string; due: string; reminder: { at: string } | null }[];
  contracts?: { id: string; title: string; status: string; updatedAt: string; reviewAt?: string; sent?: { at: string } }[];
  messages?: { id: string; conversation_id: string; content: string; created_at: string }[]; // his own CORE messages only
};

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 80);
const days = (from: string, now: number) => Math.floor((now - Date.parse(from)) / DAY);
const ago = (d: number) => (d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);
const clip = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** "remind me to X" / "I'll X" / "I will X" in his own words → X. */
const SAID = /\b(?:remind me to|i(?:'ll|’ll| will))\s+(.{3,120}?)(?:[.!?\n]|$)/gi;
export const promisesIn = (text: string) => [...text.slice(0, 4000).matchAll(SAID)].map((m) => m[1].replace(/\s+/g, " ").trim()).filter((t) => t.length >= 3 && !/^(be|do|try|see|think|let you)\b/i.test(t));

/** Every open loop in his records, deduped by key (a promise said in chat and kept in the inbox is one loop), oldest first. */
export function detectLoops(s: LoopSources): Loop[] {
  const out = new Map<string, Loop>();
  const add = (l: Loop) => { if (!out.has(l.key)) out.set(l.key, l); };
  const old = (at: string, n: number) => Number.isFinite(Date.parse(at)) && days(at, s.now) >= n;

  for (const c of s.commitments ?? []) {
    if (!SAFE_COMMIT_KINDS.has(c.source?.kind ?? "")) continue; // LIFE/journal or unknown kind: its text never becomes a loop title (brief, call opener)
    const due = c.due && c.due < s.today;
    if (c.status === "confirmed" && c.owner === "me" && due)
      add({ key: `promise:${norm(c.text)}`, kind: "promise", title: `You said you'd ${clip(c.text)}`, next: "Do it, set a new day, or close it if it no longer matters", since: c.at, evidence: { label: `Commitment inbox, due ${c.due}`, panel: "life" }, origin: c.source?.kind ?? "loop" });
    else if (c.status === "confirmed" && c.owner === "them" && due)
      add({ key: `waiting:${norm(c.text)}`, kind: "waiting", title: `Still waiting: ${clip(c.text)}`, next: "Send a short nudge or decide without it", since: c.at, evidence: { label: `Commitment inbox, due ${c.due}`, panel: "life" }, origin: c.source?.kind ?? "loop" });
    else if (c.status === "awaiting" && old(c.at, APPROVAL_DAYS))
      add({ key: `inbox:${c.id}`, kind: "inbox", title: `Unconfirmed: ${clip(c.text)}`, next: "Confirm it with a day, or dismiss it", since: c.at, evidence: { label: `Commitment inbox, caught ${ago(days(c.at, s.now))}`, panel: "life" }, origin: c.source?.kind ?? "loop" });
  }
  for (const m of s.messages ?? []) {
    if (!old(m.created_at, 1)) continue; // give him a day to do it
    for (const t of promisesIn(m.content))
      add({ key: `promise:${norm(t)}`, kind: "promise", title: `You said you'd ${clip(t)}`, next: "Turn it into a task, or close it if it's done", since: m.created_at, evidence: { label: `CORE chat, ${ago(days(m.created_at, s.now))}`, panel: "core", chat: m.conversation_id }, origin: "chat" });
  }
  for (const g of s.goals ?? []) {
    if (["done", "stopped", "draft"].includes(g.status) || !old(g.updated_at, STALL_DAYS)) continue;
    add({ key: `goal:${g.id}:${g.updated_at.slice(0, 10)}`, kind: "goal", title: `Goal stalled: ${clip(g.title)}`, next: g.status === "waiting" || g.status === "blocked" ? "Answer what it's waiting for" : "Pick one small next step, or pause it", since: g.updated_at, evidence: { label: `No progress for ${days(g.updated_at, s.now)} days`, panel: "agents" } });
  }
  for (const m of s.missions ?? []) {
    if (["completed", "cancelled"].includes(m.status) || !old(m.updated_at, STALL_DAYS)) continue;
    add({ key: `mission:${m.id}:${m.updated_at.slice(0, 10)}`, kind: "mission", title: `Mission stalled: ${clip(m.objective)}`, next: m.status === "waiting-input" || m.status === "waiting-approval" ? "Give it the answer or approval it needs" : "Resume, retry or cancel it", since: m.updated_at, evidence: { label: `MISSIONS, ${m.status}, no change for ${days(m.updated_at, s.now)} days`, panel: "agents" } });
  }
  for (const p of dueFollowups(s.prospects ?? [], s.now))
    add({ key: `prospect:${p.id}:${p.updated_at.slice(0, 10)}`, kind: "prospect", title: `${clip(p.name, 60)} hasn't replied`, next: "Draft one polite follow-up, or mark them Not now", since: p.updated_at, evidence: { label: `BUSINESS, contacted ${ago(days(p.updated_at, s.now))}`, panel: "business" } });
  for (const p of s.prospects ?? []) {
    if (p.stage !== "lead" || !p.draft?.trim() || !old(p.updated_at, APPROVAL_DAYS)) continue;
    add({ key: `approval:prospect:${p.id}:${p.updated_at.slice(0, 10)}`, kind: "approval", title: `Email to ${clip(p.name, 60)} waits for your OK`, next: "Read it and send it, or drop the draft", since: p.updated_at, evidence: { label: `BUSINESS draft, ${days(p.updated_at, s.now)} days waiting`, panel: "business" } });
  }
  for (const i of s.invoices ?? []) {
    if (i.status === "sent" && s.today > i.due)
      add({ key: `invoice:${i.id}`, kind: "invoice", title: `Invoice ${i.number} to ${clip(i.buyer.name, 50)} is overdue`, next: i.reminder ? "Approve the reminder draft" : "Draft a payment reminder", since: `${i.due}T00:00:00.000Z`, evidence: { label: `Invoices, due ${i.due}`, panel: "business" } });
    if (i.reminder && old(i.reminder.at, APPROVAL_DAYS))
      add({ key: `approval:invoice:${i.id}:${i.reminder.at.slice(0, 10)}`, kind: "approval", title: `Reminder for invoice ${i.number} waits for your OK`, next: "Read it and send it, or drop it", since: i.reminder.at, evidence: { label: `Invoices, drafted ${ago(days(i.reminder.at, s.now))}`, panel: "business" } });
  }
  for (const c of s.contracts ?? []) {
    const at = c.status === "review" ? c.reviewAt ?? c.updatedAt : c.sent?.at ?? c.updatedAt;
    if (c.status === "review" && old(at, APPROVAL_DAYS))
      add({ key: `contract:${c.id}:review`, kind: "contract", title: `Contract unsigned: ${clip(c.title)}`, next: "Read and sign it, or cancel it", since: at, evidence: { label: `Contracts, waiting your review ${days(at, s.now)} days`, panel: "business" } });
    else if (c.status === "sent" && old(at, COUNTER_DAYS))
      add({ key: `contract:${c.id}:sent`, kind: "contract", title: `No countersignature: ${clip(c.title)}`, next: "Ask them once if they had a look", since: at, evidence: { label: `Contracts, sent ${days(at, s.now)} days ago`, panel: "business" } });
  }
  return [...out.values()].sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

/** Loops still worth raising: closed and turned-into-task never come back; a snooze hides until its day. */
export function openLoops(found: Loop[], decided: Record<string, Decided>, today: string): Loop[] {
  return found.filter((l) => { const d = decided[l.key]; return !d || (d.action === "snooze" && (d.until ?? "") <= today); }).slice(0, MAX_LOOPS);
}

/** His Close / Snooze / Turn into task on one loop → the new decision, or why not. */
export function decideLoop(found: Loop[], key: unknown, action: unknown, now: number, today: string): Decided | string {
  if (typeof key !== "string" || !found.some((l) => l.key === key)) return "No such open loop";
  if (action !== "close" && action !== "snooze" && action !== "task") return "action must be close, snooze or task";
  const until = new Date(Date.parse(`${today}T12:00:00Z`) + SNOOZE_DAYS * DAY).toISOString().slice(0, 10);
  return { action, at: new Date(now).toISOString(), ...(action === "snooze" && { until }) };
}

/** The one brief / night-report line, or "" when nothing is open. */
export function loopsLine(open: Loop[]): string {
  if (!open.length) return "";
  return `${open.length} open loop${open.length > 1 ? "s" : ""}, oldest: ${open[0].title}`;
}
