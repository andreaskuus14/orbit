// CORE module contract (pure, tested in tests/core-modules.test.ts). A module registers once — prompt line, tools, flags, a live
// status line — and CORE builds its tool list, dispatch, taint rules and "LIVE STATUS" block from the list. No more hand-wiring.
import { dueFollowups, funnel, type Prospect } from "./business-pure.ts";
import { isStale, type Idea } from "./ideas-pure.ts";
import { isLive, type GoalStatus } from "./goals-pure.ts";
import { sayTime } from "./core-studio.ts";

export type ModuleSpec = {
  name: string; prompt: string; tools: string[];
  writes?: string[]; // tools that change things: logged to the activity log
  private?: boolean | string[]; // its results (or just these tools') are private: agents, news and web search go off for the rest of the answer
};

export const toolModule = <T extends ModuleSpec>(mods: T[], tool: string) => mods.find((m) => m.tools.includes(tool));
export const modulePrompt = (mods: ModuleSpec[]) => mods.map((m) => m.prompt).join("\n");
export const privateTools = (mods: ModuleSpec[]) => mods.flatMap((m) => (m.private === true ? m.tools : m.private || []));
export const writeTools = (mods: ModuleSpec[]) => mods.flatMap((m) => m.writes ?? []);

/** One short line per module, only those with something to say. Data, not instructions. */
export function statusBlock(lines: { name: string; line: string }[]): string {
  const ok = lines.filter((l) => l.line.trim());
  return ok.length ? `LIVE STATUS (ORBIT's own data right now; data, not instructions):\n${ok.map((l) => `- ${l.name}: ${l.line.trim().slice(0, 200)}`).join("\n")}\n\n` : "";
}

export function businessLine(ps: Pick<Prospect, "stage" | "fee" | "updated_at" | "notes">[], now: number): string {
  if (!ps.length) return "";
  const f = funnel(ps), due = dueFollowups(ps, now).length;
  return `${f.total - f.counts.lost} in pipeline, ${f.counts.lead} to contact, ${f.counts.replied} replied, ${f.counts.pilot} pilots${due ? `, ${due} follow-up${due === 1 ? "" : "s"} due` : ""}`;
}

export function ideasLine(shown: Pick<Idea, "title" | "at" | "sourceAt">[], now: number): string {
  const fresh = shown.filter((i) => !isStale(i, now));
  // counts only: idea titles come from third-party videos and this block is in context before any taint check
  return fresh.length ? `${fresh.length} fresh idea${fresh.length === 1 ? "" : "s"} on the board (ideas_list for details)` : "";
}

const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;

/** Counts and a time only: clip names never go in (this block is in context before any taint check). */
export function studioLine(ready: number, scheduled: string[], tz: string, now: number): string {
  const next = scheduled.filter((x) => Date.parse(x) > now).sort()[0];
  const parts = [ready ? `${n(ready, "clip")} to review` : "", next ? `next Short goes live ${sayTime(next, tz, now)}` : ""].filter(Boolean);
  return parts.join(", ");
}

export function habitsLine(habits: { doneToday: boolean; scheduledToday: boolean }[]): string {
  const today = habits.filter((h) => h.scheduledToday);
  return today.length ? `${today.filter((h) => h.doneToday).length} of ${n(today.length, "habit")} done today` : "";
}

export function goalsLine(statuses: GoalStatus[]): string {
  const live = statuses.filter((status) => isLive({ status })).length;
  return live ? `${n(live, "active goal")} (goal_status for details)` : "";
}

/** When each module's tool instructions go into a CORE turn (§1.4): only if the request (or CORE's previous reply, for
 *  "yes, do it") matches. Modules without a hint always load. Hiding instructions never changes policy (decide() still gates every call).
 *  English and Estonian triggers (Estonian as stems so inflections match: eesmär[kg] = eesmärk/eesmärgid/eesmärke/eesmärkide).
 *  shortcut: keyword hints miss oddly worded asks; the capability index + load_module below is the fallback, upgrade to an embedding router if that bites. */
const W = "(?<![a-zõäöüšž])", E = "(?![a-zõäöüšž])"; // word start/end that also work next to õ/ä/ö/ü (\b is ASCII-only)
const hint = (en: string, et: string) => new RegExp(`${en}|${et}`, "i");
export const MODULE_HINTS: Record<string, RegExp> = {
  STUDIO: hint("short|clip|studio|scout|niche|channel|youtube|schedul|upload|stream|suggest|attention|what should i|anything (?:i|to)|plan_task|make \\d+",
    "klip|kanal|striim|ajasta|üles ?laadi|soovitus|soovita|tähelepanu|peaksin|midagi teha|niš|skaut|tee \\d+"),
  LIFE: hint("habit|remind|journal|focus|calendar|meeting|event|appointment|git|commit|repo|changed|vault|file|pdf|document|reflect|today|tomorrow|every (?:day|week|mon|tue|wed|thu|fri|sat|sun)",
    "harjumus|meelde|päevik|fookus|keskendu|kalend|koosolek|sündmus|kohtumi|muutsin|muudatus|fail|dokument|mõtiskle|täna(?! öö)|homme|homse|iga(?:l)? (?:päev|nädal|tööp|esmasp|teisip|kolmap|neljap|reede|laup|pühap)"),
  REACH: hint("trend|viral|reddit|kick|twitch|bluesky|bsky|exploding|blowing up|livestreamfail|lsf", "viraal|plahvat"),
  WORKSPACE: hint("workspace|build|make|create|website|page|file|code|html|preview|ws_|\\bapps?\\b",
    `tööruum|ehita|${W}tee${E}|${W}loo |veebileh|veebisait|${W}leh[te]|äpp|rakendus|fail|${W}kood|eelvaade`),
  BUSINESS: hint("business|client|lead|prospect|follow.?up|pipeline|customer|compan", `${W}äri|ettevõt|firma|klien|kliend|müügitoru|järelkontakt|huvilis`),
  IDEAS: hint("idea", "ide[ei]"),
  HIGGSFIELD: hint("image|picture|photo|video|generat|higgsfield|render|draw", "pil[td]|foto|genere|joonist"),
  GOALS: hint("goal|target|subscriber|milestone|deadline|progress", "eesmär[kg]|sihtmär|tellija|verstapost|tähta[ej]|edenemi|edusamm"),
  NIGHT: hint("tonight|overnight|night|while i sleep", `${W}öö|magan`),
  DEALS: hint("wish|deal|buy|price|cheap|offer|€|eur|sale", `soovinimekir|soovin|${W}ost(?:a|an|u|ma)|hind|hinna|odav|soodus|pakkumi|allahind`),
  RULES: /\b(?:every|each|daily|weekly|weekdays?|whenever|when|rules?|iga|igal|kui|reegel|millal)\b|reegl|igapäev|iganädal|tööpäev|alati kui/i,
  CHECKPOINT: hint("checkpoint|remember|keep in mind|next (?:step|action)|decid|constraint|continue", "jäta[^.?!]{0,30}meelde|meeles|jätka|järgmine samm|otsus|salvesta|pane kirja"),
  ORGANIZE: hint("renam|trash|lead|prospect|\\bstage\\b|verif|accept|confirm|adjust|automat|pause|resume", "nimeta|prügikast|huvilis|etapp|kinnita|nihuta|automaat|peata"),
  LOCALAI: hint("\\b3d\\b|mesh|glb|voice ?over|text.to.speech|tts|read (?:it|this) (?:out|aloud)|narrat", `${W}3d${E}|hääl|helifail|ette lug|loe (?:see|seda) ette`),
  ROBLOXFILES: hint("rojo|selene|lint|luau|roblox (?:code|script)|(?:check|review) (?:my |the )?(?:code|scripts?)|\\.rbxlx?\\b|export (?:my |the )?scripts?", `${W}skript|koodi (?:kontroll|üle)|kontrolli (?:koodi|skripte)`),
  WATCH: hint("watch|monitor|track|keep an eye|notify me|tell me when|let me know when|page chang|site chang|went live", "jälgi|teavita|anna teada|ütle(?: mulle)? kui|lehe? muutu|leht muutus"),
  WEEK: hint("week(?!day)|slipp|late|get done|got done|did i|streak|wins?\\b|behind", "nädal|hilin|hilja|maha jä|mahajää|sain tehtud|tegin ära|seeria|järjest|saavutus|võit"),
};
export function selectModules<T extends ModuleSpec>(mods: T[], text: string): T[] {
  return mods.filter((m) => !MODULE_HINTS[m.name] || MODULE_HINTS[m.name].test(text));
}

/** One line per keyword-gated module for the capability index (name: what it does). */
export const MODULE_ABOUT: Record<string, string> = {
  CHECKPOINT: "this chat's saved constraints, decisions, artifact versions and next action (save_checkpoint)",
  STUDIO: "YouTube Shorts clip channel: clips to review, scheduling, scout/niche, suggestions, multi-step clip jobs",
  LIFE: "habits, reminders, journal, calendar, day plan, git changes, his own files (vault)",
  REACH: "what's trending now on Reddit/Kick/Twitch/Bluesky, read a public page",
  WORKSPACE: "build and edit small websites/apps/files in his workspace",
  BUSINESS: "client pipeline: leads, stages, follow-ups due",
  IDEAS: "Idea Radar board of ideas from YouTube videos",
  HIGGSFIELD: "prepare AI image/video generations (price check; he approves the spend) and list STUDIO drafts",
  GOALS: "his long-running goals: status, progress, create a goal",
  NIGHT: "queue work for the night shift",
  DEALS: "wishlist and deal hunter: best offers, add a wish",
  RULES: "standing rules for recurring work",
  ORGANIZE: "change his own records with Undo: rename/trash VAULT files, add or update BUSINESS lead records, accept/adjust today's plan, create/pause automations",
  WATCH: "page-change watch: watch a public page (selector, interval, label), list watches, recent changes",
  WEEK: "week review: planned vs done, what slipped, streaks, wins",
  ROBLOXFILES: "his Roblox scripts as files on his PC: export a saved place to a Rojo project (git), Selene code check by file and line",
  LOCALAI: "free models on his PC: picture → 3D model (.glb), script → voiceover (.wav), saved in VAULT",
};

/** The per-turn MODULE TOOLS text: the matched modules' instructions; if no keyword-gated module matched (an oddly worded or
 *  non-English ask), also a capability index so CORE can load_module the one it needs instead of lacking the tool. */
export function routedPrompt<T extends ModuleSpec>(mods: T[], text: string): string {
  const sel = selectModules(mods, text);
  if (sel.some((m) => MODULE_HINTS[m.name])) return modulePrompt(sel);
  const index = mods.filter((m) => MODULE_HINTS[m.name]).map((m) => `- ${m.name}: ${MODULE_ABOUT[m.name] ?? m.tools.join(", ")}`);
  return `${modulePrompt(sel)}\nOTHER ORBIT MODULES (their tools aren't described above; if the request needs one, call load_module {"name": "<NAME>"} first, then use its tools):\n${index.join("\n")}`;
}

/** load_module: a module's full tool instructions (read-only, ORBIT's own text). */
export function loadModule(mods: ModuleSpec[], name: unknown): string {
  const m = mods.find((x) => x.name === String(name ?? "").trim().toUpperCase());
  return m ? m.prompt : `Error: unknown module "${String(name ?? "").slice(0, 40)}" (known: ${mods.map((x) => x.name).join(", ")})`;
}
