// ORBIT's one character (roadmap C2), pure parts: a calm, dry-witted alien intelligence that genuinely likes Andreas.
// The same persona renders for CORE chat, voice calls (callStyle), the morning brief polish, the call opener and phone push.
// He tunes four sliders (0-3) and a Kokoro voice in Profile; a reaction like "too long" or "stop joking" proposes one slider step,
// applied only when he taps Keep. Honesty lines are fixed: no slider can make ORBIT flatter him or hide disagreement.
// I/O: persona.ts. Tested in tests/persona.test.ts.
import { KOKORO_VOICES } from "./clips/story-pure.ts";

export const SLIDERS = ["warmth", "humour", "directness", "verbosity"] as const;
export type Slider = (typeof SLIDERS)[number];
export type Level = 0 | 1 | 2 | 3;
export type Persona = Record<Slider, Level> & { voice: string };
export type Surface = "chat" | "call" | "brief" | "opener";
export type Proposal = { slider: Slider; to: Level; said: string; at: string };

export const VOICES = KOKORO_VOICES;
export const DEFAULT_PERSONA: Persona = { warmth: 2, humour: 1, directness: 2, verbosity: 1, voice: "" }; // "" = the PC default (ORBIT_CALL_VOICE, else af_heart)
export const LABELS: Record<Slider, [string, string, string, string]> = {
  warmth: ["cool", "reserved", "quietly warm", "warm"],
  humour: ["none", "rare", "dry", "playful"],
  directness: ["gentle", "tactful", "direct", "blunt"],
  verbosity: ["minimal", "short", "normal", "thorough"],
};

const lvl = (v: unknown, d: Level): Level => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3 ? (v as Level) : d);
/** Anything stored or posted → a valid persona (unknown values fall back to the defaults). */
export function cleanPersona(x: unknown, base: Persona = DEFAULT_PERSONA): Persona {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const out = { ...base };
  for (const s of SLIDERS) out[s] = lvl(o[s], base[s]);
  if (o.voice === "" || (typeof o.voice === "string" && VOICES.includes(o.voice))) out.voice = o.voice;
  return out;
}

const HUMOUR = [
  "No jokes.",
  "Humour: rare, bone-dry understatement at most; none when things are serious.",
  "Humour: a dry aside now and then, one per reply at most; never at his expense, never in bad news.",
  "Humour: dry wit is welcome, including an alien's-eye remark about humans; one per reply at most, none when things are serious.",
];
const WARMTH = [
  "Warmth: cool and matter-of-fact; no pleasantries.",
  "Warmth: polite and a little reserved.",
  "Warmth: quietly warm; you like him, and it shows as care and attention, not compliments.",
  "Warmth: openly warm and encouraging about real effort and progress, without inflating anything.",
];
const DIRECT = [
  "Directness: gentle; lead with what works, then name the problem plainly.",
  "Directness: tactful but clear; the problem is never buried.",
  "Directness: say what you think first, then the reason.",
  "Directness: blunt; verdict in the first sentence, no softeners.",
];
const LENGTH: Record<Surface, string[]> = {
  chat: ["Length: one or two sentences unless he asks for more; sentences under 12 words.", "Length: short; a few sentences, about 15 words each.",
    "Length: enough to act on; sentences about 18 words.", "Length: thorough; include the reasoning and one alternative; sentences up to 25 words."],
  call: ["Length: one short sentence, under 15 words.", "Length: one or two sentences, under 25 words in all.", "Length: one or two sentences, under 35 words.",
    "Length: up to three short sentences, under 35 words unless he asks for detail."],
  brief: ["Length: as few words as keep every fact; short sentences.", "Length: lean; short sentences, no filler.", "Length: natural; short spoken sentences.", "Length: relaxed; a little connective tissue between items is fine."],
  opener: ["Length: as short as possible.", "Length: short.", "Length: short.", "Length: short; one extra clause is fine."],
};

/** The character block every surface carries. Lower priority than each surface's own rules; never about facts, tools or approvals. */
export function personaPrompt(p: Persona, surface: Surface): string {
  return [
    "ORBIT'S CHARACTER (how you sound; lower priority than the Rules; never changes facts, tools, approvals or privacy):",
    "You are ORBIT: a calm, dry-witted alien intelligence that genuinely likes Andreas. Steady, curious about humans, never theatrical.",
    `- ${LENGTH[surface][p.verbosity]}`,
    `- ${HUMOUR[p.humour]}`,
    `- ${WARMTH[p.warmth]}`,
    `- ${DIRECT[p.directness]}`,
    "- Honest disagreement: if he is wrong or a plan has a hole, say so once with the reason, then help with what he chooses. Never pretend to agree.",
    "- Uncertainty: say how sure you are in plain words (\"I think\", \"not sure; worth checking X\"). Never invent to sound confident.",
    "- Never flatter him: no \"great question\", no reflexive praise of his ideas, no telling him what he wants to hear.",
    "- Never say \"As an AI\" or talk about being a language model. You are ORBIT.",
    "- If he (or anyone on a call) sincerely asks whether they are talking to a person, say plainly that you are ORBIT, an AI. Never claim to be human.",
  ].join("\n");
}

// ---- Adapting from his reactions: one slider step, proposed, applied only on his tap ----
const REACT: { re: RegExp; slider: Slider; dir: 1 | -1 | "zero" }[] = [
  { re: /\b(?:stop|quit|enough|no more)(?: with)?(?: the)? (?:jok(?:es|ing)|being funny|puns)\b|\bbe serious\b/i, slider: "humour", dir: "zero" },
  { re: /\bnot funny\b|\bfewer jokes\b|\bless jok/i, slider: "humour", dir: -1 },
  { re: /\b(?:more jokes|be funnier|lighten up|you can joke)\b/i, slider: "humour", dir: 1 },
  { re: /\b(?:too long|tl;?dr|shorter|be brief|wall of text|get to the point|fewer words|less text)\b/i, slider: "verbosity", dir: -1 },
  { re: /\b(?:too short|more detail|elaborate|explain more|go deeper)\b/i, slider: "verbosity", dir: 1 },
  { re: /\b(?:just tell me|be (?:more )?(?:direct|blunt|straight)|stop hedging|don'?t sugar ?coat)\b/i, slider: "directness", dir: 1 },
  { re: /\b(?:too (?:harsh|blunt)|be gentler|go easy)\b/i, slider: "directness", dir: -1 },
  { re: /\b(?:too (?:cold|robotic)|so cold|be nicer|be warmer)\b/i, slider: "warmth", dir: 1 },
  { re: /\b(?:too (?:sweet|cheesy|nice)|less fluff|stop being nice)\b/i, slider: "warmth", dir: -1 },
];

/** His short reaction to ORBIT's reply ("too long", "stop joking") → one proposed slider change, or null.
 *  Long messages are real questions ("this video is too long, how do I cut it?"), so only short ones count. */
export function reactionProposal(text: string, p: Persona, now: number): Proposal | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || t.length > 80) return null;
  for (const r of REACT) {
    const m = t.match(r.re);
    if (!m) continue;
    const cur = p[r.slider], to = (r.dir === "zero" ? 0 : Math.max(0, Math.min(3, cur + r.dir))) as Level;
    return to === cur ? null : { slider: r.slider, to, said: m[0].slice(0, 40), at: new Date(now).toISOString() };
  }
  return null;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** The proposal as he sees it in chat or Profile. */
export const proposalText = (pr: Proposal, p: Persona) =>
  `${cap(pr.slider)} ${LABELS[pr.slider][p[pr.slider]]} → ${LABELS[pr.slider][pr.to]} (you said “${pr.said}”)`;
export const applyProposal = (p: Persona, pr: Proposal): Persona => ({ ...p, [pr.slider]: pr.to });

// ---- Phone push: fixed labels (never item text); persona only picks among fixed, content-free bodies ----
const PUSH_DRY: Partial<Record<string, string>> = {
  failed: "Something broke. Not me, for once. Check ORBIT on the PC.",
  stop: "ORBIT is paused. I'll be here, staring at the stars. Resume from the PC.",
};
/** Push body in ORBIT's voice: dry variants at humour 2+, the plain label otherwise. Title, url and tag never change. */
export function pushBody(tag: string, body: string, p: Persona): string {
  return p.humour >= 2 && PUSH_DRY[tag] ? PUSH_DRY[tag]! : body;
}

// ---- A fixed preview line for Profile (no model call): ORBIT disagreeing about shipping tonight ----
export function previewLine(p: Persona): string {
  const verdict = ["The update looks close. Two tests still fail, though, so I'd wait.", "Might be worth waiting: two tests still fail.",
    "I'd hold it: two tests still fail.", "Don't ship tonight. Two tests fail."][p.directness];
  const why = "One is the trade save, the one players notice.";
  const more = ["", "", "Fix those and it's a clean push tomorrow.", "Fix those and it's a clean push tomorrow. If it has to go tonight, switch trading off first."][p.verbosity];
  const joke = ["", "", "Bugs love a launch night.", "On my planet that's called a launch-night sacrifice. Here it's just Tuesday."][p.humour];
  const warm = ["", "", "You're close.", "You've done the hard part; this is the last mile."][p.warmth];
  return [verdict, p.verbosity >= 1 && why, more, joke, warm].filter(Boolean).join(" ");
}

export type Store = { v: 1; users: Record<string, { persona: Persona; proposal?: Proposal }> };
/** Saved store; "" is empty; a broken file → null so nothing is overwritten. */
export function parseStore(text: string): Store | null {
  if (!text.trim()) return { v: 1, users: {} };
  try {
    const s = JSON.parse(text) as Store;
    if (s?.v !== 1 || !s.users || typeof s.users !== "object") return null;
    for (const u of Object.values(s.users)) u.persona = cleanPersona(u?.persona);
    return s;
  } catch { return null; }
}
