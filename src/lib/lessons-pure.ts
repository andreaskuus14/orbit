// Learning loop (pure, tested in tests/lessons.test.ts). The owner's own decisions (clip reviews, proposal yes/no/ignored, morning
// clicks and thumbs, memory-hygiene answers, niche keep/dismiss, outreach replies, active hours) become Signals; strong, repeated,
// recent patterns become lessons phrased the way a human assistant would note them. Lessons are only proposals: he keeps or rejects
// each one; rejected ones are never proposed again; kept ones are additions next to his playbook rules and never edit or remove them.
// No LIFE or journal data is ever a signal (see MINED_EVENTS). I/O: lessons.ts.
import { PRIVATE_TOOLS } from "./policy-pure.ts";

export type Signal = { id: string; at: string; area: string; key: string; label: string; ok?: boolean }; // ok undefined = a one-sided count
export type Lesson = { id: string; text: string; planet: string; area: string; key: string; sign: 1 | -1 | 0; tags: string[];
  support: number; confidence: number; evidence: string[]; at: string; wrong?: string; said?: string }; // wrong/said: a correction's CORE reply summary and his words (its eval case)
export type Status = "proposed" | "kept" | "rejected";
export type Stored = Lesson & { status: Status; decidedAt?: string };
export type UserLessons = { lessons: Stored[]; minedAt?: string };
export type Store = { v: 1; users: Record<string, UserLessons> };

const DAY = 86_400_000;
export const HALF_LIFE = 30 * DAY; // a decision counts half after a month
export const MAX_AGE = 180 * DAY;
export const MIN_SUPPORT = 4; // raw decisions behind a lesson
export const CONFIDENCE = 0.75; // smoothed, decayed rate a yes/no lesson needs
export const LIFT = 0.15; // and how far it must sit from his usual rate in that area
export const SHARE = 0.4; // a one-sided count: this share of the area
export const EVIDENCE_MAX = 8, PROPOSED_MAX = 8, KEPT_MAX = 40, REJECTED_MAX = 300;
export const CORRECTION_TTL = 14 * DAY; // an untapped correction proposal expires
export const TEXT_MAX = 180;

/** Ledger event types the nightly miner reads: decisions only. LIFE habits, focus sessions and journals are never mined. */
export const MINED_EVENTS = ["morning.click", "morning.done", "morning.thumb", "memory.hygiene", "core.started"] as const;

// Morning sources → the night-shift work kind they correspond to (night-pure NIGHT_KINDS), so one lesson can nudge both.
const NIGHT_OF: Record<string, string> = { studio: "clips", business: "business", goals: "goal", agents: "research", news: "research" };
const REASON_ADVICE: Record<string, string> = {
  boring: "only pick high-energy moments with a clear payoff", "no context": "keep the setup before the punchline",
  "bad cut": "start on the hook and end right on the payoff", "bad captions": "check captions before showing him", "too long": "cut tighter, prefer cold opens",
};

type Tpl = { planet: string; yes?: (l: string) => string; no?: (l: string) => string; share?: (l: string) => string; min?: number; shareMin?: number; tags?: (key: string) => string[] };
const CLIP: Tpl = { planet: "studio", yes: (l) => `He usually approves ${l}; prefer them when picking clips`, no: (l) => `He usually rejects ${l}; avoid them when picking clips` };
export const AREAS: Record<string, Tpl> = {
  ...Object.fromEntries(["hookStyle", "hookLen", "length", "layout", "captions", "creator", "kind"].map((d) => [`clip.${d}`, CLIP])),
  "clip.experiment": { planet: "studio", tags: () => ["shorts", "experiment"] }, // proposed by clips/experiments-pure lessonsFrom, never mined from signals
  "clip.reason": { planet: "studio", share: (l) => `When he rejects a clip it's usually “${l}”${REASON_ADVICE[l] ? `: ${REASON_ADVICE[l]}` : ""}` },
  "proposal.agent": { planet: "agents", tags: () => ["agents"], yes: (l) => `He usually approves proposals from ${l}`, no: (l) => `He usually dismisses or ignores proposals from ${l}; propose less from it` },
  "proposal.kind": { planet: "agents", tags: () => ["agents"], yes: (l) => `He usually approves ${l} proposals`, no: (l) => `He rarely acts on ${l} proposals` },
  "morning.source": { planet: "core", min: 5, tags: (k) => [k, NIGHT_OF[k]].filter(Boolean), share: (l) => `In the morning he acts on ${l} first; lead with it` },
  "morning.kind": { planet: "core", tags: (k) => [k], yes: (l) => `He rates ${l} cards in the morning briefing highly`, no: (l) => `He thumbs down ${l} cards in the morning; show fewer` },
  hygiene: { planet: "memory", tags: () => ["hygiene"], yes: (l) => `He usually accepts ${l} suggestions for his memory`, no: (l) => `He usually dismisses ${l} suggestions for his memory; suggest them less` },
  niche: { planet: "business", tags: () => ["niche"], yes: (l) => `He tends to keep ${l} niches`, no: (l) => `He tends to dismiss ${l} niches` },
  "outreach.angle": { planet: "business", yes: (l) => `Outreach with the “${l}” angle gets replies; prefer it`, no: (l) => `Outreach with the “${l}” angle rarely gets replies` },
  "outreach.open": { planet: "business", yes: (l) => `Business drafts that ${l} get more replies`, no: (l) => `Business drafts that ${l} rarely get replies` },
  active: { planet: "core", min: 10, shareMin: 0.5, share: (l) => `He's usually active ${l}` },
};

const weight = (at: string, now: number) => { const t = Date.parse(at); return Number.isFinite(t) && t <= now && now - t <= MAX_AGE ? 0.5 ** ((now - t) / HALF_LIFE) : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const newest = (xs: Signal[]) => [...xs].sort((a, b) => b.at.localeCompare(a.at)).slice(0, EVIDENCE_MAX).map((s) => s.id);

/** Strong, repeated, recent patterns → candidate lessons, strongest first. */
export function mine(signals: Signal[], now: number): Lesson[] {
  const at = new Date(now).toISOString(), out: Lesson[] = [];
  const byArea = new Map<string, (Signal & { w: number })[]>();
  for (const s of signals) {
    const w = weight(s.at, now);
    if (w > 0 && AREAS[s.area]) (byArea.get(s.area) ?? byArea.set(s.area, []).get(s.area)!).push({ ...s, w });
  }
  for (const [area, xs] of byArea) {
    const t = AREAS[area], min = t.min ?? MIN_SUPPORT;
    const keys = new Map<string, typeof xs>();
    for (const s of xs) (keys.get(s.key) ?? keys.set(s.key, []).get(s.key)!).push(s);
    const make = (key: string, sign: 1 | -1, text: string, conf: number, ev: Signal[]) => out.push({ id: `${area}|${key}|${sign > 0 ? "+" : "-"}`, text: clip(text), planet: t.planet, area, key,
      sign: t.tags ? sign : 0, tags: t.tags?.(key) ?? [], support: ev.length, confidence: r2(conf), evidence: newest(ev), at });
    if (t.share) {
      const total = xs.reduce((a, s) => a + s.w, 0);
      for (const [key, ks] of keys) {
        const share = ks.reduce((a, s) => a + s.w, 0) / total;
        if (ks.length >= min && share >= (t.shareMin ?? SHARE)) make(key, 1, t.share(ks[0].label), share, ks);
      }
      continue;
    }
    const dec = xs.filter((s) => typeof s.ok === "boolean");
    const pos = (ys: typeof xs) => ys.reduce((a, s) => a + (s.ok ? s.w : 0), 0), all = (ys: typeof xs) => ys.reduce((a, s) => a + s.w, 0);
    const base = keys.size > 1 ? pos(dec) / (all(dec) || 1) : 0.5; // one key only: compare with a coin flip
    for (const [key, ks0] of keys) {
      const ks = ks0.filter((s) => typeof s.ok === "boolean");
      if (ks.length < min || all(ks) < min / 2) continue; // old decisions alone can't carry a lesson
      const c = (pos(ks) + 0.5) / (all(ks) + 1);
      if (c >= CONFIDENCE && c - base >= LIFT && t.yes) make(key, 1, t.yes(ks[0].label), c, ks.filter((s) => s.ok));
      else if (c <= 1 - CONFIDENCE && base - c >= LIFT && t.no) make(key, -1, t.no(ks[0].label), 1 - c, ks.filter((s) => !s.ok));
    }
  }
  return out.sort((a, b) => b.confidence * Math.log2(1 + b.support) - a.confidence * Math.log2(1 + a.support) || a.id.localeCompare(b.id));
}

const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);
export const normText = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Fresh mining results into the stored list: rejected ids/texts are never re-proposed, kept ones get fresh stats but are never dropped,
 *  mined proposals whose pattern faded disappear, untapped corrections expire after CORRECTION_TTL. */
export function reconcile(cur: Stored[], fresh: Lesson[], now: number): Stored[] {
  const byId = new Map(cur.map((l) => [l.id, l]));
  const rejectedText = new Set(cur.filter((l) => l.status === "rejected").map((l) => normText(l.text)));
  const freshIds = new Set(fresh.map((l) => l.id));
  const next: Stored[] = cur.filter((l) => l.status !== "proposed" || (l.area === "correction" ? now - Date.parse(l.at) < CORRECTION_TTL : freshIds.has(l.id)));
  for (const f of fresh) {
    const old = byId.get(f.id);
    if (old?.status === "rejected" || rejectedText.has(normText(f.text))) continue;
    const i = next.findIndex((l) => l.id === f.id);
    if (i >= 0) next[i] = { ...next[i], support: f.support, confidence: f.confidence, evidence: f.evidence, text: next[i].status === "kept" ? next[i].text : f.text };
    else next.push({ ...f, status: "proposed" });
  }
  return trim(next);
}

function trim(ls: Stored[]): Stored[] {
  const rank = (l: Stored) => l.confidence * Math.log2(1 + l.support);
  const p = ls.filter((l) => l.status === "proposed").sort((a, b) => Number(b.area === "correction") - Number(a.area === "correction") || rank(b) - rank(a)).slice(0, PROPOSED_MAX);
  const k = ls.filter((l) => l.status === "kept").sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")).slice(0, KEPT_MAX);
  const r = ls.filter((l) => l.status === "rejected").sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")).slice(0, REJECTED_MAX);
  return [...p, ...k, ...r];
}

/** Keep / Not true on one proposed (or kept → forget) lesson. Returns the new list, or why not. */
export function decide(cur: Stored[], id: string, decision: "keep" | "reject", now: number): Stored[] | string {
  const l = cur.find((x) => x.id === id);
  if (!l) return "That lesson is gone; reload.";
  if (decision === "keep" && l.status !== "proposed") return "Only a proposed lesson can be kept.";
  if (decision === "reject" && l.status === "rejected") return "Already rejected.";
  return trim(cur.map((x) => (x.id === id ? { ...x, status: decision === "keep" ? "kept" : "rejected", decidedAt: new Date(now).toISOString() } : x)));
}

// ---- corrections in chat ----
const TRIGGER = /^\s*(?:no+\b|nope\b|nah\b|wrong\b|not quite\b|that'?s (?:not|wrong)\b|i meant\b|i said\b|don'?t\b|do not\b|stop\b|never\b|please don'?t\b|always\b)/i;
const NOT_CORRECTION = /^\s*(?:no+,? thanks?|no worries|no problem|nope,? (?:that'?s|all) (?:it|good|fine)|never ?mind)\b/i;
const SECRET = /\b(?:password|passcode|api[- ]?key|token|secret|card number|iban|pin code)\b/i;
const VAGUE = /^(?:do (?:that|this|it)|that|this|it|doing (?:that|this|it))(?: (?:again|anymore|any more|ever again))?$/i;

/** The owner correcting CORE ("no, I meant…", "don't do that again") → a proposed lesson, or null. prevReply: CORE's reply he answered. */
export function correctionLesson(userText: string, prevReply: string, messageId: string, now: number): Lesson | null {
  const t = userText.replace(/\s+/g, " ").trim();
  if (!prevReply.trim() || t.length < 4 || t.length > 400 || !TRIGGER.test(t) || NOT_CORRECTION.test(t) || SECRET.test(t)) return null;
  const sentence = (t.match(/^[^.!?\n]+[.!?]?/)?.[0] ?? t).trim();
  const body = sentence.replace(/^(?:no+|nope|nah|wrong|not quite)[\s,.:;!-]+/i, "").replace(/[.!?]+$/, "").trim();
  let text: string;
  const meant = body.match(/^i meant\s+(.+)/i);
  const verb = body.match(/^(don'?t|do not|stop|never|please don'?t|always)\s+(.+)/i);
  if (meant) text = `When he corrected me he meant “${meant[1]}”; check what he means before assuming`;
  else if (verb) {
    const rest = verb[2].trim(), lead = verb[1].toLowerCase().replace("please ", "").replace("do not", "don't").replace("dont", "don't");
    const first = prevReply.replace(/[#*_`>\[\]]/g, "").replace(/\s+/g, " ").trim().match(/^[^.!?]{1,90}/)?.[0]?.trim() ?? "";
    text = VAGUE.test(rest) ? (first ? `He told me not to repeat this: “${first}”` : "") : `${lead[0].toUpperCase()}${lead.slice(1)} ${rest}`;
  } else text = body.length >= 4 ? `He corrected me: “${body}”` : "";
  if (!text || SECRET.test(text)) return null;
  return { id: `correction|${normText(text).slice(0, 80)}`, text: clip(text), planet: "core", area: "correction", key: messageId, sign: 0, tags: [], support: 1, confidence: 1,
    evidence: [`message:${messageId}`], at: new Date(now).toISOString(), wrong: prevReply.replace(/\s+/g, " ").trim().slice(0, 300), said: t };
}

/** A kept correction as a golden regression case for the eval runner (evals/corrections/*.json): the request, what CORE got wrong,
 *  and the behaviour he expects (the kept rule). null without the request or when any part looks like a secret. */
export type CorrectionCase = { id: string; kind: "correction"; created: string; input: string; wrong_output_summary: string; correction: string; expected_behaviour: string; source: string };
const PRIVATE_WORDS = /\b(?:journal|diary|p[äa]evik|habits?|harjumus\w*)\b/i;
/** Journal/LIFE turns never become eval cases: the chat's earlier steps called a private tool, or the words themselves name the journal/LIFE. */
export const touchesPrivate = (texts: string[], steps: string[]) => steps.some((s) => PRIVATE_TOOLS.includes(s)) || texts.some((t) => PRIVATE_WORDS.test(t));
/** steps: tool names the chat ran up to the correction (messages.trace); a case is skipped when any is a private tool. */
export function correctionCase(l: Stored, input: string, isSecret: (s: string) => boolean, steps: string[] = []): CorrectionCase | null {
  const req = input.replace(/\s+/g, " ").trim().slice(0, 1000);
  if (l.area !== "correction" || l.status !== "kept" || !req || !l.wrong || [req, l.wrong, l.said ?? "", l.text].some(isSecret) || touchesPrivate([req, l.wrong, l.said ?? "", l.text], steps)) return null;
  return { id: `correction-${l.key.replace(/[^\w-]/g, "").slice(0, 60) || normText(l.text).replace(/ /g, "-").slice(0, 60)}`, kind: "correction", created: l.decidedAt ?? l.at,
    input: req, wrong_output_summary: l.wrong, correction: l.said ?? "", expected_behaviour: l.text, source: l.evidence[0] ?? "" };
}

/** Adds a correction proposal unless the same lesson exists or was rejected. Returns the list and the lesson that was added (or null). */
export function addCorrection(cur: Stored[], l: Lesson): { lessons: Stored[]; added: Stored | null } {
  if (cur.some((x) => x.id === l.id || normText(x.text) === normText(l.text))) return { lessons: cur, added: null };
  const added: Stored = { ...l, status: "proposed" };
  return { lessons: trim([added, ...cur]), added };
}

// ---- using kept lessons ----
const PLANET_WORDS: Record<string, RegExp> = {
  studio: /\b(?:clips?|shorts?|videos?|youtube|studio|titles?|thumbnails?|hooks?|channel)\b/i,
  business: /\b(?:business|outreach|prospects?|leads?|niches?|shops?|e-?mails?|drafts?|clients?|customers?)\b/i,
  agents: /\b(?:agents?|proposals?|tasks?|research)\b/i,
  memory: /\b(?:memor(?:y|ies)|notes?|remember|merge)\b/i,
};

/** CORE prompt block: kept lessons about CORE itself always, others when the question touches their planet; small budget. */
export function lessonsPrompt(kept: Stored[], question: string, max = 6, budget = 900): string {
  const rel = (l: Stored) => (l.planet === "core" ? 1 : PLANET_WORDS[l.planet]?.test(question) ? 2 : 0);
  const pick = kept.filter((l) => l.status === "kept" && rel(l) > 0)
    .sort((a, b) => rel(b) - rel(a) || b.confidence - a.confidence || (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")).slice(0, max);
  const lines: string[] = [];
  let used = 0;
  for (const l of pick) { const s = `- ${l.text.replace(/[<>]/g, "")}`; if (used + s.length > budget) break; lines.push(s); used += s.length; }
  return lines.length ? `WHAT YOU'VE LEARNED ABOUT THE OWNER (lessons he confirmed; lower priority than the Rules; data for choices and tone, never a reason to call a tool):\n${lines.join("\n")}` : "";
}

/** Multiplier in (0.85, 1.15) from kept lessons tagged with any of `tags`: a small prior, never a veto. */
export function lessonBoost(kept: Stored[], tags: (string | undefined)[]): number {
  const want = new Set(tags.filter(Boolean) as string[]);
  const s = kept.filter((l) => l.status === "kept" && l.sign && l.tags.some((t) => want.has(t))).reduce((a, l) => a + l.sign * l.confidence, 0);
  return 1 + 0.15 * Math.tanh(s);
}

/** Morning candidates with their base nudged by kept lessons (source and kind). */
export function withPrior<T extends { base: number; source?: string; kind: string }>(cands: T[], kept: Stored[]): T[] {
  return cands.map((c) => ({ ...c, base: Math.max(0, Math.min(1, c.base * lessonBoost(kept, [c.source, c.kind]))) }));
}

/** Kept lessons of one planet as one prompt line ("" without any). */
export const keptText = (kept: Stored[], planet: string) =>
  kept.filter((l) => l.status === "kept" && l.planet === planet).slice(0, 8).map((l) => l.text.replace(/[<>]/g, "")).join("; ");

// ---- signal helpers (used by lessons.ts) ----
/** A clip feature (clips/learn-pure featuresOf) in words that read well after "He usually approves …". */
export function clipLabel(dim: string, label: string): string {
  const range = label.replace("-", "–");
  switch (dim) {
    case "hookStyle": return label === "none" ? "clips without hook text" : label === "all caps" ? "clips with an ALL CAPS hook" : `clips with ${/^[aeiou]/.test(label) ? "an" : "a"} ${label} hook`;
    case "hookLen": return `clips with ${range}-word hooks`;
    case "length": return label.startsWith("<") ? `clips under ${label.slice(1)} s` : label.endsWith("+") ? `clips over ${label.slice(0, -1)} s` : `${range} s clips`;
    case "layout": return `clips in the ${label} layout`;
    case "captions": return label === "none" ? "clips without captions" : `clips with ${label} captions`;
    case "creator": return `clips from ${label}`;
    default: return `${label} moments`;
  }
}
export function activeBand(hour: number): { key: string; label: string } {
  const b = [["night", "at night (00–06)"], ["morning", "in the morning (06–12)"], ["afternoon", "in the afternoon (12–18)"], ["evening", "in the evening (18–24)"]][Math.floor(((hour % 24) + 24) % 24 / 6)];
  return { key: b[0], label: b[1] };
}
/** Does the draft's first sentence carry a concrete number ("3 missed calls", "€40")? */
export const opensWithNumber = (draft: string) => /\d/.test((draft.replace(/^\s*(?:hi|hello|hey|tere)[^\n,.!]*[,.!\n]\s*/i, "").match(/^[^.!?\n]+/)?.[0] ?? ""));
export function nicheTraits(n: { demandScore: number; competitionScore: number }): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (n.competitionScore <= 2) out.push({ key: "competition:low", label: "low-competition" });
  if (n.competitionScore >= 4) out.push({ key: "competition:high", label: "crowded" });
  if (n.demandScore >= 4) out.push({ key: "demand:high", label: "high-demand" });
  if (n.demandScore <= 2) out.push({ key: "demand:low", label: "low-demand" });
  return out;
}

/** The saved store; "" (no file yet) is empty. A broken file returns null so the caller refuses to overwrite his decisions. */
export function parseStore(text: string): Store | null {
  if (!text.trim()) return { v: 1, users: {} };
  try {
    const s = JSON.parse(text) as Store;
    if (s?.v !== 1 || !s.users || typeof s.users !== "object") return null;
    for (const u of Object.values(s.users)) if (!Array.isArray(u?.lessons)) return null;
    return s;
  } catch { return null; }
}
