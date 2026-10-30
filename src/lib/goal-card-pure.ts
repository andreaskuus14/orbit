// Idea → goal (pure; tests in tests/goal-card.test.ts). A vague, idea-level message gets a Goal card that CORE drafts itself
// (objective, why, deliverables, acceptance checks, assumptions, effort, first steps, agent) instead of asking the owner to restate it.
// The card rides in a ```goal fenced JSON block of CORE's reply; the chat renders it with [Start] [Change…] [Not now].
// Start → /api/missions (existing mission path); it never sends, spends or publishes: those steps still wait for the owner's click.
import { et, etQuestion } from "./et-ask-pure.ts";

export type GoalCard = {
  objective: string; why?: string; deliverables: string[]; acceptance: string[]; assumptions: string[];
  effort: string; steps: string[]; agent: string; fromMemory?: string[]; question?: string;
};

// Idea-level: a wish or a direction ("better", "more players", "help me get clients"), not a deliverable with a done-check.
const WISH = /\b(?:better|nicer|more|improve|grow|boost|help me|i want|i'd like|i wish|idea|somehow|something|make .* (?:pop|good|great|cool)|get (?:more )?(?:clients|customers|players|views|subs|subscribers|sales))\b/i;
const WISH_ET = et("parem|ilusam|rohkem|kasva|aita|tahan|tahaks|soovin|idee|kuidagi|midagi|uusi kliente|kliente|mängijaid|vaatajaid");
// Concrete: a number, a date/deadline, a named file/output with an exact spec, or a done-condition.
const CONCRETE = /\b(?:\d+|by (?:mon|tue|wed|thu|fri|sat|sun|tomorrow|today|next|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|done when|acceptance|so that it|index\.html|\.\w{2,4}\b)/i;
const CONCRETE_ET = et("\\d|valmis siis|tähtaeg|homseks|tänaseks|nädala lõpuks");
const QUESTION_EN = /^\s*(?:how|what|why|which|when|where|who|is|are|does|do|did|can|could|should|explain)\b/i;

/** True when the message is an idea/wish without a clear deliverable or done-check (EN + ET). Questions aren't ideas. */
export function isVague(q: string): boolean {
  const t = q.trim();
  if (t.length < 8 || QUESTION_EN.test(t) || etQuestion(t)) return false;
  if (CONCRETE.test(t) || CONCRETE_ET.test(t)) return false;
  return WISH.test(t) || WISH_ET.test(t);
}

// A wrong guess here costs money, reaches other people or can't be undone: worth the one question.
const COSTLY = /\b(?:spend|budget|pay|buy|ads?|advert\w*|send|email|e-mail|dm|message (?:them|people|clients)|publish|post|upload|launch|announce|delete|remove|cancel|contract|sign|price|pricing)\b/i;
const COSTLY_ET = et("kuluta|eelarve|maksa|osta|reklaam|saada|meili|avalda|postita|lae üles|kustuta|eemalda|tühista|leping|allkirj|hind");
/** May the card ask its one question? Only when the request touches spend, send, publish, delete or another external effect. */
export const mayAsk = (q: string) => COSTLY.test(q) || COSTLY_ET.test(q);

// Never make the owner retype a sentence; offered choices are buttons.
export const EXACT = /\b(?:exact (?:line|lines|sentence|wording|words|phrase)|send (?:this|these|the following) (?:exact|line|lines|message)|as (?:separate|two) messages|type (?:exactly|this))\b|täpselt (?:see|need) (?:lause|rida|read)/i;

const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const list = (v: unknown, n = 8) => (Array.isArray(v) ? v.map((x) => s(x, 240)).filter(Boolean).slice(0, n) : []);

/** The card from CORE's reply (```goal {json} ```), normalised, or null. */
export function parseGoalCard(answer: string): GoalCard | null {
  const m = answer.match(/```goal\s*\n([\s\S]*?)```/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]) as Record<string, unknown>;
    const c: GoalCard = { objective: s(o.objective, 300), why: s(o.why, 300) || undefined, deliverables: list(o.deliverables), acceptance: list(o.acceptance),
      assumptions: list(o.assumptions), effort: s(o.effort, 120), steps: list(o.steps, 3), agent: s(o.agent, 40), fromMemory: list(o.fromMemory), question: s(o.question, 240) || undefined };
    return c.objective ? c : null;
  } catch { return null; }
}

/** The reply text without the card block (what the chat shows as prose). */
export const withoutCard = (answer: string) => answer.replace(/```goal\s*\n[\s\S]*?```/, "").trim();

/** Problems with a card (empty = valid). `question` = the owner's message, for question gating. */
export function cardProblems(c: GoalCard, question = ""): string[] {
  const p: string[] = [];
  if (!c.objective || /[.!?]\s+\S/.test(c.objective)) p.push("objective must be one sentence");
  if (!c.deliverables.length) p.push("no deliverables");
  if (!c.acceptance.length) p.push("no acceptance checks");
  // Checkable: a number, a named thing to look at, or a yes/no condition; not "looks better".
  for (const a of c.acceptance) if (!/\d|\b(?:has|have|shows?|lists?|contains?|exists?|passes|loads|links?|includes?|on|in)\b|\b(?:on|sisaldab|näitab|olemas)\b/i.test(a)) p.push(`acceptance not checkable: ${a}`);
  if (!c.assumptions.length) p.push("no assumptions listed");
  if (!c.effort) p.push("no effort/budget");
  if (c.steps.length !== 3) p.push("needs exactly 3 first steps");
  if (!c.agent) p.push("no planet/agent named");
  const asks = (c.question ? 1 : 0) + c.steps.concat(c.assumptions).filter((x) => /\?\s*$/.test(x)).length;
  if (asks > 1) p.push("more than one question");
  if (c.question && !mayAsk(question)) p.push("asked a question where a default would do");
  if (EXACT.test(JSON.stringify(c))) p.push("tells the owner to send exact wording");
  return p;
}

/** /api/missions body for [Start]. The constraint keeps external effects behind the owner's later approval. */
export function goalMission(c: GoalCard, lang?: string) {
  return {
    objective: c.objective, acceptance: c.acceptance.join("; "), assumptions: c.assumptions, lang,
    constraints: ["Don't send, spend, post or publish anything: prepare it and leave it for the owner's approval"],
    steps: c.steps.map((request) => ({ agent: c.agent.toLowerCase(), request })),
  };
}

/** Choices CORE offered as a trailing "Choices: A | B | Both" line → button labels (each sends itself). */
export const parseChoices = (answer: string): string[] =>
  (answer.match(/^\s*(?:Choices|Valikud):\s*(.+)$/im)?.[1] ?? "").split("|").map((x) => x.trim()).filter((x) => x && x.length <= 80).slice(0, 4);

const RULES = "IDEA → GOAL: never ask the owner to restate or type an exact sentence, and never offer choices as lines to send: end with one line `Choices: <a> | <b> | <both>` and ORBIT shows them as buttons.";

/** CORE prompt hint: draft a Goal card for an idea-level message, or revise the last card after the owner's correction. */
export function goalHint(question: string, lastAnswer = ""): string {
  const revising = /```goal\s*\n/.test(lastAnswer);
  if (!revising && !isVague(question)) return `${RULES}\n\n`;
  const ask = mayAsk(question)
    ? "You may set \"question\" to ONE short question only if a wrong guess would spend, send, publish or delete something; otherwise leave it out."
    : "Don't ask any question: pick sensible defaults and list them as assumptions.";
  return `${RULES}\n${revising ? "The owner is correcting your last Goal card in free words: revise that card (same JSON shape) to match, keep what he didn't change." : "The owner's message is an idea, not a finished goal. Don't ask him to restate it: draft the goal yourself."} ` +
    "First check memory (memory_search / the project pack) for this project's context, preferences and recent work. " +
    `Reply with 1-2 lines, then a fenced block \`\`\`goal with JSON {"objective": one sentence, "why": from memory if known, "deliverables": [..], "acceptance": [concrete checkable checks], "assumptions": [each a default you picked, editable], "effort": "time/budget", "steps": [exactly 3 first steps], "agent": the planet or agent that does it, "fromMemory": [facts you took from memory]}. ${ask} ` +
    "Starting the goal never sends, spends or publishes; those steps wait for his approval.\n\n";
}
