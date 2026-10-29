// Standing instructions (roadmap 8.4): a plain-language rule ("Every weekday 7:30 check deals", "Kui klient vastab, koosta vastus")
// → { trigger: schedule | event, action, scope, permissions }. No model call: the owner confirms the parsed version before it is active.
// Execution (rules.ts) reuses ORBIT's own runners only: agent tasks, skills (as a Nova task), missions, the deal hunter and week facts.
// Client-safe (no node imports).
import { translate, type Key, type Lang } from "./i18n-pure.ts";

export type RuleSchedule = { days: number[]; hour: number; minute: number }; // days: 0 = Sunday; this PC's local time
export const RULE_EVENTS = {
  "client.replied": "When a client replies",
  "deal.found": "When the deal hunter finds a deal",
  "memory.created": "When you save a note",
  "briefing.ready": "When a news briefing is ready",
} as const;
export type RuleEvent = keyof typeof RULE_EVENTS;
export type RuleTrigger = { type: "schedule"; schedule: RuleSchedule } | { type: "event"; event: RuleEvent };
export type OrbitAction = "deals" | "week_review";
export type RuleAction =
  | { kind: "orbit"; id: OrbitAction }
  | { kind: "agent"; agent: string; prompt: string }
  | { kind: "skill"; name: string; input: string }
  | { kind: "mission"; objective: string };
export type ParsedRule = { name: string; trigger: RuleTrigger; action: RuleAction; scope: string; permissions: string[] };
export type RuleResult = { at: string; ok: boolean; text: string; taskId?: string; missionId?: string };
export type Rule = ParsedRule & {
  id: string; text: string; status: "proposed" | "active" | "paused"; by: "owner" | "core";
  created: string; activeSince: string | null; lastRun: string | null; last: RuleResult | null;
  today?: DayCount; // event rules only: runs and skipped events on this PC's local day
  seen?: string[]; // event rules only: recent `event:rules:<id>` keys already run, so a replay after a crash never runs twice
};

const L = "(?<![\\p{L}\\d])", R = "(?![\\p{L}\\d])"; // word edges that also work for õ/ä/ö/ü (JS \b is ASCII-only)
const re = (src: string, flags = "iu") => new RegExp(src, flags);
const EN_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ET_DAYS = ["pühapäev", "esmaspäev", "teisipäev", "kolmapäev", "neljapäev", "reede", "laupäev"];
const ALL = [0, 1, 2, 3, 4, 5, 6], WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY = `(?:(?:on|every|each|iga|igal)\\s+)*`;

// Day phrases, most specific first; each also gets cut from the action text.
const DAY_RULES: [RegExp, (m: RegExpMatchArray) => number[]][] = [
  ...EN_DAYS.map((d, i): [RegExp, () => number[]] => [re(`${L}${EVERY}${d}s?${R}`), () => [i]]),
  ...ET_DAYS.map((d, i): [RegExp, () => number[]] => [re(`${L}${EVERY}${d}\\p{L}*`), () => [i]]),
  [re(`${L}${EVERY}(?:week|work)\\s?days?${R}|${L}${EVERY}(?:tööpäev|argipäev)\\p{L}*`), () => WEEKDAYS],
  [re(`${L}${EVERY}(?:the\\s+)?weekends?${R}|${L}${EVERY}nädalavahetus\\p{L}*`), () => [0, 6]],
  // "every morning": only "every " is cut, so the time rules still read "morning"
  [re(`${L}(?:every\\s?day|daily|each\\s+day)${R}|${L}(?:every|each)\\s+(?=(?:morning|evening|afternoon|night)${R})|${L}iga\\s?päev\\p{L}*|${L}igal?\\s+(?=hommik|õhtu)`), () => ALL],
  [re(`${L}(?:every\\s+week|once\\s+a\\s+week)${R}|${L}(?:iga\\s+nädal|igal\\s+nädalal|kord\\s+nädalas)${R}`), () => [1]],
];
// "weekly" as an adjective ("my weekly review on Sunday") only sets the day when nothing else does; it stays in the action text.
const WEEKLY = re(`${L}(?:weekly|iganädalase?)${R}`);

const TIME_RULES: [RegExp, (m: RegExpMatchArray) => [number, number] | null][] = [
  [re(`${L}(?:at\\s+|kell\\s+|@\\s*)?(\\d{1,2})[:.](\\d{2})\\s*(am|pm)?${R}`), (m) => hm(+m[1], +m[2], m[3])],
  [re(`${L}(?:at|kell)\\s+(\\d{1,2})\\s*(am|pm)?${R}`), (m) => hm(+m[1], 0, m[2])],
  [re(`${L}(\\d{1,2})\\s*(am|pm)${R}`), (m) => hm(+m[1], 0, m[2])],
  [re(`${L}(?:at\\s+)?(?:noon|midday)${R}|${L}keskpäeval${R}`), () => [12, 0]],
  [re(`${L}(?:in\\s+the\\s+)?mornings?${R}|${L}hommik\\p{L}*`), () => [8, 0]],
  [re(`${L}(?:in\\s+the\\s+)?afternoons?${R}|${L}pärastlõunal${R}`), () => [15, 0]],
  [re(`${L}(?:in\\s+the\\s+)?evenings?${R}|${L}õhtu(?:l|ti|ne)?${R}`), () => [19, 0]],
  [re(`${L}(?:at\\s+)?night${R}|${L}öösel${R}`), () => [22, 0]],
];
function hm(h: number, m: number, ampm?: string): [number, number] | null {
  const p = ampm?.toLowerCase();
  if (p && (h < 1 || h > 12)) return null;
  if (p === "pm" && h < 12) h += 12;
  if (p === "am" && h === 12) h = 0;
  return h <= 23 && m <= 59 ? [h, m] : null;
}

const LEAD = re(`${L}(?:when|whenever|once|each\\s+time|every\\s+time|if|kui|alati\\s+kui|iga\\s+kord\\s+kui)${R}`);
const EVENT_RULES: [RuleEvent, RegExp][] = [
  ["client.replied", re(`${L}(?:a\\s+|the\\s+|any\\s+)?(?:client|customer|prospect|lead)s?\\s+(?:\\w+\\s+){0,2}(?:repl(?:y|ies|ied)|answers?|responds?|writes?\\s+back|gets?\\s+back)${R}|${L}klien\\p{L}*\\s+(?:\\p{L}+\\s+)?(?:vastab|vastas|kirjutab|kirjutas)${R}`)],
  ["deal.found", re(`${L}(?:you\\s+|the\\s+hunter\\s+|orbit\\s+)?(?:find|finds|found|spot|spots)\\s+(?:a\\s+)?(?:good\\s+|great\\s+)?(?:deal|bargain)s?${R}|${L}(?:a\\s+)?(?:good\\s+|great\\s+)?(?:deal|bargain)s?\\s+(?:is\\s+|gets\\s+)?(?:found|shows?\\s+up|appears?|comes?\\s+up)${R}|${L}(?:leiad|leitakse|leiab)\\s+(?:\\p{L}+\\s+)?(?:pakkumis|diil)\\p{L}*`)],
  ["memory.created", re(`${L}i\\s+(?:save|add|upload)\\s+(?:a\\s+|an\\s+)?(?:note|memory|document|file)s?${R}|${L}(?:salvestan|lisan)\\s+(?:\\p{L}+\\s+)?(?:märkme|mälu|faili|dokumendi)\\p{L}*`)],
  ["briefing.ready", re(`${L}(?:a\\s+|the\\s+|new\\s+|news\\s+)*briefing\\s+(?:is\\s+)?(?:ready|done|arrives?|comes\\s+in)${R}|${L}uudis\\p{L}*\\s+(?:\\p{L}+\\s+)?valmi\\p{L}*`)],
];

const AGENT_HINTS: [string, RegExp][] = [
  ["pulse", re(`${L}(?:news|headlines|briefing)${R}|${L}uudis`)],
  ["sentinel", re(`${L}(?:watch|monitor|keep\\s+an\\s+eye|track)${R}|${L}jälgi`)],
  ["atlas", re(`${L}(?:research|look\\s+into|investigate|find\\s+out)${R}|${L}uuri`)],
  ["vector", re(`${L}(?:stats|statistics|numbers|analytics|metrics)${R}|${L}statistik`)],
  ["echo", re(`${L}(?:memories|notes|organi[sz]e)${R}|${L}märkme`)],
  ["forge", re(`${L}(?:draft|write|prepare|compose|outline|reply|answer)${R}|${L}(?:kirjuta|koosta|valmista|vasta)`)],
];
export const AGENT_SCOPE: Record<string, string> = {
  nova: "Your memory, tasks and the news", atlas: "News and the public web", pulse: "News feeds", sentinel: "News and your memory",
  echo: "Your memory", forge: "Your memory", vector: "ORBIT's activity numbers",
};
const NAMES: Record<string, string> = { nova: "Nova", atlas: "Atlas", pulse: "Pulse", sentinel: "Sentinel", echo: "Echo", forge: "Forge", vector: "Vector" };
const APPROVALS = "Drafts only: anything that sends, publishes or spends waits in Approvals for your click";

/** What the rule may touch and do, shown before he confirms (and on every rule card). */
export function ruleCard(trigger: RuleTrigger, action: RuleAction): { scope: string; permissions: string[] } {
  const client = trigger.type === "event" && trigger.event === "client.replied" ? " + that client's BUSINESS entry" : "";
  if (action.kind === "orbit" && action.id === "deals") return { scope: "Your wishlist and public shop listings", permissions: ["Reads public listings (read-only)", "Never contacts sellers or buys anything"] };
  if (action.kind === "orbit") return { scope: "ORBIT's own records for this week", permissions: ["Read-only, no model call", "Changes nothing"] };
  if (action.kind === "skill") return { scope: `Skill "${action.name}"${client}`, permissions: ["Runs your saved skill as a Nova agent task", APPROVALS] };
  if (action.kind === "mission") return { scope: `News, the public web and your memory${client}`, permissions: ["Runs as a mission: Atlas researches, then Forge writes it up", APPROVALS] };
  return { scope: `${AGENT_SCOPE[action.agent] ?? "Your memory"}${client}`, permissions: [`Runs as a ${NAMES[action.agent] ?? action.agent} agent task`, APPROVALS] };
}

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,.;:–—-]+|[\s,;:–—-]+$/g, "")
  .replace(re(`^(?:(?:and|then|please|ja|siis|palun)${R}[\\s,]*)+`), "")
  .replace(re(`(?:[\\s,]+(?:and|ja|at|on|every|each|kell|iga|igal))+$`), "").replace(/\s+([,.;:!?])/g, "$1").trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Plain-language rule → parsed rule, or why not (in words he can act on). English and some Estonian. */
export function parseRule(input: string): ParsedRule | { error: string } {
  let text = String(input ?? "").replace(/\s+/g, " ").trim()
    .replace(re(`^(?:(?:make|add|create|set\\s+up|new)\\s+(?:a\\s+)?(?:standing\\s+)?(?:rule|instruction)|standing\\s+(?:rule|instruction)|rule|(?:uus\\s+)?reegel)\\s*[:,-]?\\s*`), "")
    .replace(/[.!]+$/, "").slice(0, 500);
  if (text.length < 5) return { error: "Write the rule in a sentence, e.g. “Every weekday 7:30 check deals”" };

  let trigger: RuleTrigger | null = null, rest = text;
  const lead = text.match(LEAD);
  for (const [event, rx] of EVENT_RULES) {
    const m = lead && text.match(rx);
    if (!m || m.index === undefined || m.index < lead.index!) continue;
    trigger = { type: "event", event };
    const before = tidy(text.slice(0, lead.index)), after = tidy(text.slice(m.index + m[0].length));
    rest = after || before; // "When a client replies, draft an answer" | "Draft an answer when a client replies"
    break;
  }
  if (!trigger) {
    let days: number[] | null = null, time: [number, number] | null = null, badTime = false;
    for (const [rx, f] of DAY_RULES) {
      const found = [...rest.matchAll(new RegExp(rx.source, "giu"))];
      if (!found.length) continue;
      days = [...new Set([...(days ?? []), ...found.flatMap((m) => f(m))])];
      rest = rest.replace(new RegExp(rx.source, "giu"), " ");
    }
    for (const [rx, f] of TIME_RULES) {
      const m = rest.match(rx);
      if (!m) continue;
      time = f(m); badTime = !time;
      rest = rest.replace(rx, " ");
      break;
    }
    if (badTime) return { error: "That time doesn't exist; use e.g. 7:30, 18:00 or 6pm" };
    if (!days && WEEKLY.test(rest)) days = [1];
    if (!days && time) days = ALL; // "at 7:30 check deals" = every day
    if (!days) return { error: "Say when: e.g. “every weekday at 7:30”, “on Sunday” or “when a client replies”" };
    trigger = { type: "schedule", schedule: { days: days.sort((a, b) => a - b), hour: time?.[0] ?? 9, minute: time?.[1] ?? 0 } };
  }
  rest = tidy(rest);
  if (rest.replace(/[^\p{L}]/gu, "").length < 3) return { error: "Say what ORBIT should do, e.g. “…, draft an answer”" };

  const action = parseAction(rest, trigger);
  return { name: cap(rest).slice(0, 60), trigger, action, ...ruleCard(trigger, action) };
}

function parseAction(text: string, trigger: RuleTrigger): RuleAction {
  const skill = text.match(re(`${L}(?:run\\s+|use\\s+)?(?:the\\s+|my\\s+)?(?:skill|oskus)\\s+["“']?([^"”':,]{2,60}?)["”']?\\s*(?:[:,]\\s*(.*))?$`));
  if (skill) return { kind: "skill", name: skill[1].trim(), input: (skill[2] ?? "").trim() };
  const mission = text.match(re(`^(?:start\\s+|run\\s+|launch\\s+|käivita\\s+)?(?:a\\s+)?(?:mission|missioon)\\p{L}*\\s*[:,-]?\\s*(.{3,})$`));
  if (mission) return { kind: "mission", objective: cap(tidy(mission[1])) };
  const evt = trigger.type === "event" ? trigger.event : null;
  if (evt !== "deal.found" && re(`${L}(?:deals?|bargains?|wish\\s?list)${R}|${L}(?:pakkumis|soodus|diil)`).test(text)) return { kind: "orbit", id: "deals" };
  if (re(`(?:${L}week\\p{L}*|nädala\\p{L}*)\\s+(?:\\p{L}+\\s+){0,2}(?:review|recap|summary|ülevaade|kokkuvõte)|${L}review\\s+(?:of\\s+)?my\\s+week${R}`).test(text)) return { kind: "orbit", id: "week_review" };
  const agent = AGENT_HINTS.find(([, rx]) => rx.test(text))?.[0] ?? (evt === "client.replied" ? "forge" : "nova");
  return { kind: "agent", agent, prompt: cap(text) };
}

/* ---------------- schedule math (this PC's local time, like automations) ---------------- */

const at = (now: Date, dayOffset: number, s: RuleSchedule) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, s.hour, s.minute);

/** The next time the schedule fires, strictly after `now`. */
export function nextRun(s: RuleSchedule, now: Date): Date | null {
  for (let i = 0; i <= 7; i++) { const d = at(now, i, s); if (d > now && s.days.includes(d.getDay())) return d; }
  return null;
}
/** The latest slot at or before `now`. */
export function lastSlot(s: RuleSchedule, now: Date): Date | null {
  for (let i = 0; i <= 7; i++) { const d = at(now, -i, s); if (d <= now && s.days.includes(d.getDay())) return d; }
  return null;
}
/** Run now? Once per slot, never for slots before he confirmed/resumed it, missed slots caught up within 3 h (PC asleep). */
export function ruleDue(s: RuleSchedule, lastRun: string | null, activeSince: string | null, now: Date, graceMs = 3 * 3600_000): boolean {
  const slot = lastSlot(s, now);
  if (!slot || !activeSince || now.getTime() - slot.getTime() > graceMs || slot.getTime() < Date.parse(activeSince)) return false;
  return !lastRun || Date.parse(lastRun) < slot.getTime();
}

const pad = (n: number) => String(n).padStart(2, "0");
export function describeTrigger(t: RuleTrigger, lang: Lang = "en"): string {
  if (t.type === "event") return translate(lang, `rules.ev.${t.event}`);
  const { days, hour, minute } = t.schedule, k = days.join();
  const d = k === ALL.join() ? translate(lang, "rules.everyDay") : k === WEEKDAYS.join() ? translate(lang, "rules.everyWeekday") : k === "0,6" ? translate(lang, "rules.weekends")
    : translate(lang, "rules.everyDays", { days: days.map((x) => translate(lang, `rules.day.${x}` as Key)).join(days.length === 2 ? translate(lang, "rules.and") : ", ") });
  return translate(lang, "rules.at", { d, t: `${pad(hour)}:${pad(minute)}` });
}
export function describeAction(a: RuleAction, lang: Lang = "en"): string {
  if (a.kind === "orbit") return translate(lang, a.id === "deals" ? "rules.act.deals" : "rules.act.week");
  if (a.kind === "skill") return translate(lang, "rules.act.skill", { name: a.name, input: a.input ? `: ${a.input}` : "" });
  if (a.kind === "mission") return translate(lang, "rules.act.mission", { objective: a.objective });
  return `${NAMES[a.agent] ?? a.agent}: ${a.prompt}`;
}

/** This PC's local day, "YYYY-MM-DD". */
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const EVENT_RUNS_PER_DAY = 5;
export type DayCount = { day: string; runs: number; skipped: number };
/** Count one event hit against the daily cap: ok=false means skip it (and it is counted as skipped). */
export function countEventRun(c: DayCount | undefined, now: Date): { ok: boolean; count: DayCount } {
  const day = localDay(now), cur = c?.day === day ? c : { day, runs: 0, skipped: 0 };
  return cur.runs < EVENT_RUNS_PER_DAY ? { ok: true, count: { ...cur, runs: cur.runs + 1 } } : { ok: false, count: { ...cur, skipped: cur.skipped + 1 } };
}

export const MAX_RULES = 50;
/** Add a confirmed (owner) or proposed (CORE) rule; same text twice is refused. */
export function addRule(list: Rule[], text: string, p: ParsedRule, by: Rule["by"], id: string, now: string): Rule[] | string {
  if (list.length >= MAX_RULES) return `You have ${MAX_RULES} rules; delete one first`;
  if (list.some((r) => r.text.toLowerCase() === text.trim().toLowerCase())) return "That rule already exists";
  const active = by === "owner";
  return [...list, { ...p, id, text: text.trim(), status: active ? "active" : "proposed", by, created: now, activeSince: active ? now : null, lastRun: null, last: null }];
}

/** CORE's propose_rule guard: the owner's own latest message, phrased as a recurring or "when …" instruction. */
export function ruleBlocked(question: string, tainted: boolean): string {
  if (tainted) return "only call propose_rule as your first tool, for the user's own request";
  if (!re(`${L}(?:every|each|daily|weekly|weekdays?|weekends?|whenever|when|rule|iga|igal|kui|reegel|tööpäeviti)${R}|${L}(?:on\\s+)?(?:${EN_DAYS.join("|")})s?${R}`).test(question))
    return "only when the user asks for a standing rule in their latest message (\"every Sunday …\", \"when a client replies …\")";
  return "";
}
