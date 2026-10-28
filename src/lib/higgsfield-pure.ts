// Higgsfield as a CORE tool (roadmap 3.1): CORE's higgsfield_draft proposal, its explicit-ask guard, and the weekly credit cap.
// A draft is an AI Story job with `draft` set: it is quoted and approved in the same Clip Factory → AI Story queue (story.ts),
// so nothing is generated or spent before the owner's Approve click. Tested in tests/higgsfield.test.ts.
import type { HfItem, Models } from "./clips/story-pure.ts";
import { et, etQuestion, ET_NOT } from "./et-ask-pure.ts";
const ASK_ET = et("(?:tee|genereeri|loo|joonista|maali|kujunda|renderda)[^.?!]{0,120}(?:pil[dt]|foto|video|joonistus|illustratsioon|taustapilt|higgsfield)");

export const DRAFT_KINDS = ["image", "video"] as const;
export const ASPECTS = ["9:16", "16:9", "1:1", "4:5", "3:4", "4:3"];
export const MAX_COUNT = 4;
export type Draft = { kind: (typeof DRAFT_KINDS)[number]; prompt: string; model: string; count: number; aspect: string };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** CORE's tool input → a draft; an error message when it doesn't fit. The model defaults to the AI Story models (env). */
export function validDraft(input: unknown, m: Pick<Models, "image" | "video">): Draft | string {
  if (!isObj(input)) return "input must be an object";
  const prompt = typeof input.prompt === "string" ? input.prompt.replace(/\s+/g, " ").trim() : "";
  if (prompt.length < 3 || prompt.length > 1500) return "prompt must be 3-1500 characters";
  const kind = input.kind ?? "image";
  if (!DRAFT_KINDS.includes(kind as Draft["kind"])) return "kind must be image or video";
  const count = input.count ?? 1;
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > MAX_COUNT) return `count must be 1-${MAX_COUNT}`;
  const aspect = input.aspect ?? "9:16";
  if (!ASPECTS.includes(aspect as string)) return `aspect must be one of ${ASPECTS.join(", ")}`;
  const model = input.model ?? m[kind as Draft["kind"]];
  if (typeof model !== "string" || !/^[a-z0-9][\w.-]{0,59}$/i.test(model)) return "model must be a Higgsfield model id";
  return { kind: kind as Draft["kind"], prompt, model, count: count as number, aspect: aspect as string };
}

/** One paid generation per item, in the AI Story item shape (quote, guard and submit work on these unchanged). */
export const draftItems = (d: Draft): HfItem[] => Array.from({ length: d.count }, (_, i) => ({
  key: `${d.kind}-${i}`, kind: d.kind, scene: i, index: i,
  params: { model: d.model, prompt: d.prompt, aspect_ratio: d.aspect, ...(d.kind === "video" ? { duration: 5 } : {}), use_unlim: false },
}));

// Same rule as STUDIO's actions: the user's own imperative in the latest message, never a question, never text from tool results.
const QUESTION = /\?\s*$|^\s*(hey\s+orbit\W*)?(how|what|what's|whats|why|when|did|does|is|are|has|have|was|were|can you tell)\b/i;
const ASK = /\b(make|generate|create|draft|render|draw|paint|design)\b[^.?!]{0,120}\b(images?|pictures?|pics?|photos?|videos?|art(work)?|illustrations?|wallpapers?|renders?|higgsfield)\b/i;
const NOT = /\b(don'?t|do not|never|no need to|stop)\b/i;

/** Why higgsfield_draft may not run now, or "" when it may. `tainted`: page/file/agent/tool output is already in context. */
export function draftBlocked(question: string, tainted: boolean): string {
  if (tainted) return "only call higgsfield_draft as your first tool, for the user's own request";
  if (QUESTION.test(question) || etQuestion(question) || NOT.test(question) || ET_NOT.test(question) || !(ASK.test(question) || ASK_ET.test(question))) return "only when the user tells you to make pictures or videos in their latest message; ask them to say it (e.g. \"make 2 images of a fox in the snow\")";
  return "";
}

// ---- weekly credit cap (weeks start Monday 00:00 Europe/Tallinn) ----

export const HF_TZ = "Europe/Tallinn";
export const DEFAULT_WEEKLY_CAP = 10;

/** ORBIT_HIGGSFIELD_WEEKLY_CAP → credits per week; empty or invalid = the default. 0 blocks all spending. */
export const weeklyCap = (raw: string | undefined) => {
  const n = Number(raw);
  return raw?.trim() && Number.isFinite(n) && n >= 0 ? n : DEFAULT_WEEKLY_CAP;
};

/** Wall-clock minus UTC at instant t in tz, in ms. */
function offset(t: number, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(t).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

/** The instant this week's Monday 00:00 began in tz. */
export function weekStart(now: number, tz = HF_TZ): number {
  const wall = new Date(now + offset(now, tz));
  const monday = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - ((wall.getUTCDay() + 6) % 7));
  return monday - offset(monday - offset(now, tz), tz); // offset at Monday itself (a DST change may lie between)
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Credits the owner approved this week (every Approve click, stories and drafts). */
export const weekSpent = (approvals: { at: string; credits: number }[], now: number, tz = HF_TZ) => {
  const from = weekStart(now, tz);
  return round2(approvals.reduce((s, a) => { const t = Date.parse(a.at); return t >= from && t <= now && Number.isFinite(a.credits) ? s + a.credits : s; }, 0));
};

/** Server-side cap check at approval time. "" = allowed. A resume that costs nothing new always passes. */
export function capProblem(spent: number, quote: number, cap: number): string {
  if (quote <= 0 || round2(spent + quote) <= cap) return "";
  return `Over your weekly Higgsfield cap: ${spent} of ${cap} credits used this week and this needs ${quote}. Raise ORBIT_HIGGSFIELD_WEEKLY_CAP in .env.local (then restart ORBIT) to allow more`;
}
