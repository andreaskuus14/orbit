// ORBIT's diary (roadmap 4), pure parts: pick the day's facts from ORBIT's own records, a no-model template, the prompt,
// output cleaning, paging/search and the CORE block. Sources: last night's run, ledger counts, lessons,
// self-heal issues, episodes. Never journal/LIFE data: ledger types are an allowlist and call episodes (conversation) are skipped.
// I/O: diary.ts. Tested in tests/diary.test.ts.
import type { LedgerEvent } from "./ledger-pure.ts";
import type { NightRun } from "./night-pure.ts";

export type Entry = { day: string; text: string; model: boolean; at: string };
export type Store = { v: 1; users: Record<string, Entry[]> };
export type Facts = { did: string[]; learned: string[]; wrong: string[]; next: string[] };
export type FactsIn = {
  now: number; run?: NightRun; events: LedgerEvent[];
  lessons: { text: string; status: string; at: string; decidedAt?: string }[];
  issues: { title: string; status: string; last: string }[];
  episodes: { type: string; when: string; title: string }[]; day: string;
};

const DAY = 86_400_000;
export const KEEP = 400, PAGE = 10, MAX_FACTS = 4, TEXT_MAX = 900;
/** Ledger types the diary may count: ORBIT's own work only (never life.habit, journal.saved, focus.session). */
export const DIARY_EVENTS = ["core.turn", "tool.call", "clip.published", "goal.step", "health.issue", "lesson.kept", "lesson.rejected"] as const;

const clip = (s: string, n = 120) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const label = (s: string) => clip(s.replace(/^\P{L}+/u, "").replace(/^Tonight:\s*/i, ""), 80); // "🌙 Tonight: x" → "x"
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const recent = (iso: string | undefined, now: number) => { const t = iso ? Date.parse(iso) : NaN; return t <= now && now - t < DAY; };

/** The last 24 hours of ORBIT's own records → short fact lines in four buckets (each capped). */
export function pickFacts(x: FactsIn): Facts {
  const f: Facts = { did: [], learned: [], wrong: [], next: [] };
  const r = x.run, items = r?.items ?? [];
  const by = (s: string) => items.filter((i) => i.status === s);
  if (items.length) {
    const done = by("done"), appr = by("approval");
    f.did.push(`night shift: ${[done.length && `${done.length} done`, appr.length && `${appr.length} waiting for his approval`, by("failed").length && `${by("failed").length} failed`].filter(Boolean).join(", ") || "nothing finished"}`);
    for (const i of [...done, ...appr].slice(0, 2)) f.did.push(`worked on ${label(i.label)}`);
  }
  for (const i of by("failed").slice(0, 2)) { f.wrong.push(`${label(i.label)} failed${i.why ? ` (${clip(i.why, 80)})` : ""}`); f.next.push(`retry ${label(i.label)}`); }
  if (r?.deferred) f.next.push(`pick up ${plural(r.deferred, "task")} the budget pushed back`);
  if (r?.stopped === "usage") f.wrong.push("ran into the usage limit before finishing");

  const ev = x.events.filter((e) => (DIARY_EVENTS as readonly string[]).includes(e.type) && recent(e.at, x.now));
  const n = (t: string) => ev.filter((e) => e.type === t).length;
  const toolFails = ev.filter((e) => e.type === "tool.call" && !(e.data as { ok: boolean }).ok).length;
  if (n("core.turn")) f.did.push(`answered ${plural(n("core.turn"), "CORE message")}`);
  if (n("clip.published")) f.did.push(`saw ${plural(n("clip.published"), "Short")} go live`);
  const steps = ev.filter((e) => e.type === "goal.step" && (e.data as { status: string }).status === "done").length;
  if (steps) f.did.push(`finished ${plural(steps, "goal step")}`);
  if (toolFails >= 2) { f.wrong.push(`${toolFails} of ${n("tool.call")} tool calls failed`); f.next.push("check why those tools failed before leaning on them"); }

  for (const i of x.issues.filter((i) => recent(i.last, x.now))) {
    if (i.status === "resolved") f.did.push(`self-heal: "${clip(i.title, 70)}" is fixed`);
    else { f.wrong.push(`${i.status === "regressed" ? "came back" : "new problem"}: "${clip(i.title, 70)}"`); f.next.push(`watch "${clip(i.title, 50)}"`); }
  }
  for (const l of x.lessons) {
    if (l.status === "kept" && recent(l.decidedAt, x.now)) f.learned.push(`he confirmed a lesson: ${clip(l.text)}`);
    else if (l.status === "proposed" && recent(l.at, x.now)) f.learned.push(`I noticed: ${clip(l.text)}`);
  }
  for (const e of x.episodes.filter((e) => e.type !== "call" && e.when === x.day).slice(0, 2)) f.did.push(`noted: ${clip(e.title, 90)}`);
  for (const k of Object.keys(f) as (keyof Facts)[]) f[k] = [...new Set(f[k])].slice(0, MAX_FACTS);
  return f;
}
export const hasFacts = (f: Facts) => Object.values(f).some((xs) => xs.length);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join("; ")} and ${xs.at(-1)}`);
/** The plain no-model entry: 3–6 sentences from the facts alone. */
export function templateEntry(f: Facts): string {
  const out = [f.did.length ? `Today I ${list(f.did.map((d) => d.replace(/^night shift:/, "ran the night shift:")))}.` : "A quiet day; I had little of my own to do."];
  out.push(f.learned.length ? `What I learned: ${list(f.learned)}.` : "Nothing new learned that I can point to.");
  if (f.wrong.length) out.push(`What I got wrong today: ${list(f.wrong)}.`);
  if (f.next.length) out.push(`What I'll try tomorrow: ${list(f.next)}.`);
  if (out.length < 3) out.push("Steady on.");
  return out.join(" ");
}

export const DIARY_SYSTEM = [
  "You write ORBIT's private work diary: one entry for today, in ORBIT's own voice, first person.",
  "Rules: 3 to 6 sentences of plain text. No markdown, lists, headings or quotes around the entry.",
  "Use only the facts given; never invent numbers, names or events. Say nothing about Andreas's private life.",
  "If there are WRONG facts, include one sentence starting \"What I got wrong today:\". If there are NEXT facts, include one sentence starting \"What I'll try tomorrow:\". Otherwise leave those out.",
].join("\n");
export function diaryPrompt(f: Facts, persona: string): string {
  const b = (k: keyof Facts) => (f[k].length ? f[k].map((x) => `- ${x}`).join("\n") : "- (none)");
  return `${persona}\n\nTODAY'S FACTS (ORBIT's own records)\nDID:\n${b("did")}\nLEARNED:\n${b("learned")}\nWRONG:\n${b("wrong")}\nNEXT:\n${b("next")}\n\nWrite the entry.`;
}

/** Model text → a clean 3–6 sentence entry, or null (empty, too short, or it talked about being an AI) so the template is used. */
export function cleanEntry(raw: string): string | null {
  const t = raw.replace(/```[\s\S]*?```/g, " ").replace(/^\s*(?:#+|[-*•]|\d+[.)])\s*/gm, "").replace(/[*_`]+/g, "").replace(/^["“]|["”]$/g, "").replace(/\s+/g, " ").trim();
  if (!t || /\bas an ai\b|language model/i.test(t)) return null;
  const s = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (s.length < 2) return null;
  return clip(s.slice(0, 6).join(" "), TEXT_MAX);
}

/** Add or replace the day's entry, newest first, capped. */
export function putEntry(xs: Entry[], e: Entry): Entry[] {
  return [e, ...xs.filter((x) => x.day !== e.day)].sort((a, b) => b.day.localeCompare(a.day)).slice(0, KEEP);
}
/** "ORBIT's log": search (every word must match the day or text) then page (1-based). */
export function pageEntries(xs: Entry[], q: string, page: number, size = PAGE) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const hit = words.length ? xs.filter((e) => words.every((w) => `${e.day} ${e.text}`.toLowerCase().includes(w))) : xs;
  const pages = Math.max(1, Math.ceil(hit.length / size)), p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { entries: hit.slice((p - 1) * size, p * size), total: hit.length, page: p, pages };
}

/** Only "what did you learn / get wrong" style questions get the log as context. */
export const asksDiary = (q: string) => /\bwhat (?:did|have) you (?:learn|learnt|learned|been learning|get wrong|got wrong)\b|\b(?:your|orbit'?s) (?:diary|log)\b|\bwhat did you do (?:this week|today|last night)\b/i.test(q);
export function diaryBlock(xs: Entry[], n = 7): string {
  return xs.length ? `ORBIT'S LOG (your own diary, newest first; answer from it, in first person):\n${xs.slice(0, n).map((e) => `- ${e.day}: ${e.text}`).join("\n")}` : "";
}

/** Saved store; "" is empty; a broken file → null so nothing is overwritten. */
export function parseStore(text: string): Store | null {
  if (!text.trim()) return { v: 1, users: {} };
  try {
    const s = JSON.parse(text) as Store;
    return s?.v === 1 && s.users && typeof s.users === "object" ? s : null;
  } catch { return null; }
}
