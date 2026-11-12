// CORE tool permission policy: every CORE tool call passes decide() before it runs (core.ts tool dispatch); T2/T3 verdicts go to the ledger.
// "core.ts:NNN" refs point at the inline guards this replaced (core.ts at fb313a4); tests/policy.test.ts pins decide() to them.
// Tiers: T0 read own data, T1 read the public web, T2 change own data, T3 act on the outside world (owner-approved only, AGENTS.md rule 6).
import { coreToolRefusal, PAUSED_MSG } from "./stop-all-pure.ts";
import { typedText } from "./attach-pure.ts";
import { actionBlocked, STUDIO_TOOLS, type StudioTool } from "./core-studio.ts";
import { LIFE_TOOLS, lifeWriteBlocked, type LifeTool } from "./core-life.ts";
import { WS_TOOLS, wsTainted, wsWriteBlocked } from "./core-workspace.ts";
import type { WsGate } from "./ws-intent-pure.ts";
import { createGoalBlocked } from "./goals-pure.ts";
import { asksToRemember } from "./reflect-pure.ts";
import { confirmsDecision } from "./decisions-pure.ts";
import { checkpointBlocked } from "./checkpoint-pure.ts";
import { draftBlocked } from "./higgsfield-pure.ts";
import { tonightBlocked } from "./night-pure.ts";
import { wishBlocked } from "./deals-pure.ts";
import { ruleBlocked } from "./rules-pure.ts";
import { watchBlocked } from "./pagewatch-pure.ts";
import { AREA_INFO, autonomyAllows, type Area, type Levels } from "./autonomy-pure.ts";
import { et, etQuestion } from "./et-ask-pure.ts";
import { createdLeads, isOpsTool, opsAsked, opsBlocked } from "./core-operator-pure.ts";
import { outboundLeak, outgoing, privateResults } from "./outbound-pure.ts";
import { hashLeak } from "./phrase-hash-pure.ts";
import { isPluginTool, outsideIn, pluginDecision, type Gate } from "./plugins-pure.ts";

export type Tier = "T0" | "T1" | "T2" | "T3";
/** egress: refused because the outgoing arguments would carry private text (the owner may Allow once). */
export type Decision = { allow: boolean; tier: Tier; reason: string; egress?: boolean; allowOnce?: { id: string; journal: boolean } };
/** core.ts binds it to the chat, foreground turns only (allow-once-pure book): never set for background turns, scheduler or Auto. */
export type AllowOnceHook = { has(tool: string, input: unknown): boolean; take(tool: string, input: unknown): boolean; offer(tool: string, input: unknown, journal: boolean): { id: string; journal: boolean } };
/** stopAll: Stop-all switch; attach: files attached this turn; pins: pinned project notes in context;
 *  steps: this answer's tool results so far, in core.ts's "You called <tool> <json>\nRESULT:\n..." form; question: latest user message. */
export type PolicyCtx = { stopAll: boolean; attach: boolean; pins: boolean; steps: string[]; question: string; privateTools?: readonly string[]; autonomy?: Partial<Levels>;
  /** an earlier turn of this chat had private data in context (journal/LIFE, attachments, pins): it is still in the session (C03) */
  carried?: boolean;
  /** what the stored taint says put private data in this chat (core-taint.json, survives a restart): "unknown" = an entry without it
   *  (older file, broken file) → plugins and outbound tools are refused. Left out by callers that don't track it: as before. */
  carriedKind?: "private" | "local" | "unknown";
  /** phrase hashes of earlier turns' private / local-plugin text (outbound-pure phraseHashes): checked after a restart too */
  carriedHashes?: readonly string[]; carriedLocalHashes?: readonly string[];
  /** the owner clicked Allow once for exactly this call (allow-once-pure): egress checks are skipped, every other check still runs */
  egressAllowed?: boolean;
  allowOnce?: AllowOnceHook;
  /** per-install HMAC key of the carried phrase hashes (durable.ts hashKey) */
  hashKey?: string | Uint8Array;
  /** an earlier turn of this chat read outside text (pages, agents, invites, files…): it is still in the session, so the operator grant
   *  needs his own ask in this message, as after reading his stores (core.ts tracks it per chat) */
  outsideEarlier?: boolean;
  /** private text in this turn's context besides tool results (attachments, pinned notes, an earlier turn's private results): outbound calls are checked against it */
  privateText?: readonly string[];
  /** Earlier turns' local-plugin output (core.ts keeps it apart): private for remote targets, free for local ones. */
  localText?: readonly string[];
  /** workspace names + CORE's pending build offer in this chat (ws-intent-pure.ts) */
  ws?: WsGate;
  /** leads CORE added in this chat on earlier turns (core-operator-pure ownLeadsIn); this turn's come from steps */
  ownLeads?: readonly string[];
  /** callable MCP plugin tools (plugins-pure gates(): plugin__<server>__<tool> → mode/tier) */
  plugins?: Record<string, Gate> };

export const TIERS: Record<string, Tier> = {
  navigate: "T0", goal_status: "T0", mission_status: "T0", business_status: "T0", ideas_list: "T0",
  studio_status: "T0", learned: "T0", suggestions: "T0",
  life_status: "T0", life_journal: "T0", vault_search: "T0", vault_read: "T0", calendar_events: "T0", plan_day: "T0", git_summary: "T0",
  ws_list: "T0", ws_read: "T0", week_review: "T0", wishlist: "T0",
  load_module: "T1", // returns a module's own instruction text (core-modules-pure loadModule)
  read_more: "T1", // rereads a clipped result already in this turn (clip-store-pure)
  web_search: "T1", fetch_url: "T1", scrape_page: "T1", read_news: "T1", reach_trending: "T1", reach_read: "T1", find_outliers: "T1",
  save_memory: "T2", ask_agent: "T2", create_goal: "T2", start_mission: "T2", plan_task: "T2", run_scout: "T2", run_niche: "T2",
  propose_rule: "T2", // saves a standing rule as proposed; nothing runs until the owner's Confirm click in Agents → Rules
  add_wish: "T2", // adds to his own wishlist; the hunter only reads public pages, and nothing is bought or sent by ORBIT
  save_checkpoint: "T2", // his own chat checkpoint (local file); every line can be edited or deleted on the Checkpoint card
  queue_tonight: "T2", // adds to the night shift's own queue; the night run's outside effects still wait for owner approvals
  life_check: "T2", life_add_habit: "T2", life_remind: "T2", ws_write: "T2", ws_create: "T2", ws_fetch_image: "T2", ws_run: "T2", ws_stop: "T2",
  vault_move: "T2", vault_rename: "T2", lead_create: "T2", lead_update: "T2", life_plan: "T2", automation_create: "T2", automation_pause: "T2", // ORGANIZE: his own records, each with Undo
  schedule_approved: "T3", // uploads owner-approved clips to YouTube
  higgsfield_draft: "T3", // proposes a Higgsfield spend (price check only); the spend itself is the owner's story.approve click
  ws_picture_draft: "T3", // stand-in art at the site's image paths + one priced draft per site; the spend is the owner's story.approve click
  studio_drafts: "T0", // lists STUDIO's drafts and their state
  ws_inspire_image: "T3", // reference words from an image search, then the same priced draft as higgsfield_draft for an original brief
  local_3d: "T2", local_tts: "T2", local_transcribe: "T2", // free models on his own PC (tools/local-ai); the result is a new VAULT file, nothing leaves the PC
  roblox_export: "T2", // rojo syncback into his own projects folder + a local git commit (tools/roblox); nothing leaves the PC
  roblox_lint: "T0", // selene on his exported project, read-only
  local_image: "T2", // ComfyUI on his PC (tools/comfyui): a new VAULT picture, the prompt never leaves the PC
  browse: "T1", // ORBIT's hidden browser on a public page: read-only (non-GET requests blocked), submits/logins refused for his click
  save_decision: "T2", watch_add: "T2", watch_list: "T0", watch_changes: "T0", // page watch (pagewatch.ts): a local record; the checks only read public pages
  daily_runs: "T0", // daily.ts: reads the three daily workflows' own records
};

// T3 runs only behind an owner-click approval (AGENTS.md rule 6): the token each path checks before anything leaves ORBIT.
export const APPROVAL_PATHS: Record<string, string> = {
  schedule_approved: 'clip.status "approved" from the owner\'s Approve click in STUDIO review; scheduleAll uploads only those clips',
  higgsfield_draft: "never spends: it saves a draft and asks Higgsfield the price (hf-guard quote mode, get_cost only); credits are spent only by the owner's Approve click on that quote in Clip Factory → AI Story (story.approve)",
  ws_picture_draft: "never spends: draws stand-ins in the workspace and queues one priced higgsfield draft per site (quote mode); generation only after the owner's story.approve click in STUDIO → Websites, then the photos are saved at the slot paths",
  ws_inspire_image: "never spends: reference search returns words only (nothing saved); a brief is queued as a priced higgsfield draft (quote mode); generation only after the owner's story.approve click",
};
// The UI's own T3 actions. Not CORE tools (decide() refuses them as unknown): they run only from the owner's click, with these tokens.
export const UI_APPROVALS: Record<string, string> = {
  "business.send": 'POST /api/business {action:"send", id, seen}: the draft stamp the owner read; Resend Idempotency-Key orbit-<id>-<seen>',
  "story.approve": 'POST /api/studio/clips/story {action:"approve", id, credits}: the credits quote the owner accepted; refused under Stop-all or past ORBIT_HIGGSFIELD_WEEKLY_CAP (also for CORE\'s higgsfield_draft jobs)',
  "studio.schedule": 'POST /api/studio/clips/schedule: only clips with the owner\'s Approve click (status "approved")',
  "studio.publish": 'POST /api/studio/clips/<job>/<clip>/publish: only a clip with status "approved"',
};

// Profile → Autonomy area of each tool that starts work, writes or acts: an area set to Off refuses it (autonomyAllows "owner").
export const TOOL_AREA: Record<string, Area> = {
  ask_agent: "research", start_mission: "research", plan_task: "research", run_niche: "research", run_scout: "studio-prepare", save_memory: "memory",
  create_goal: "goals", queue_tonight: "night-shift", add_wish: "deals", schedule_approved: "studio-publish", higgsfield_draft: "higgsfield-spend", ws_picture_draft: "higgsfield-spend",
  ws_run: "operator-build", // a local demo server of his own workspace (AGENTS.md rule 6 category A); never public
  local_3d: "operator-build", local_tts: "operator-build", local_transcribe: "operator-build", local_image: "operator-build", // local models writing new VAULT files (category A)
  roblox_export: "operator-build", // local project files + git commit (category A)
  watch_add: "research", // later reads of a public page (category A)
};

// Mirror of core-modules.ts privateTools(MODULES): LIFE (private: true), WORKSPACE ws_read, BUSINESS (private: true), WEEK (private: true), ORGANIZE lead_update + life_plan.
// shortcut: hand-copied because core-modules.ts can't load under node --test; update both when a module's private flag changes.
export const PRIVATE_TOOLS = [...LIFE_TOOLS, "ws_read", "business_status", "week_review", "lead_update", "life_plan"];
// Where each outbound tool's text goes: "model" = any model (agents, search/news/outlier pipelines, local TTS/image models, image
// prompts to ComfyUI/Pollinations/Higgsfield). Private text in a model-bound call is a hard refusal: Allow once never unlocks it.
export const EGRESS_CLASS: Record<string, "model" | "web"> = {
  ask_agent: "model", read_news: "model", web_search: "model", find_outliers: "model", local_tts: "model", local_image: "model",
  ws_inspire_image: "model", ws_picture_draft: "model",
  browse: "web", watch_add: "web", fetch_url: "web", scrape_page: "web", reach_read: "web", ws_fetch_image: "web",
};
export const MODEL_TOOLS = Object.keys(EGRESS_CLASS).filter((t) => EGRESS_CLASS[t] === "model");
export const LINK_TOOLS = ["browse", "watch_add", "fetch_url", "scrape_page", "read_news", "ask_agent", "reach_read", "ws_fetch_image", "ws_inspire_image", "ws_picture_draft"];
export const LEAK_TOOLS = ["ask_agent", "read_news", "web_search", "find_outliers", "local_tts", "local_image"]; // local_tts/local_image: journal/LIFE text never goes to a model, local ones included

// Text from outside ORBIT (pages, news, search hits, agent results, prospect mail, attached files) can't start an agent task by itself.
// Includes every read tool whose own description calls its output third-party data: calendar invites, Idea Radar's video text,
// shop offer titles, vault/workspace file text, git commit subjects.
/** His own stores that hold other people's text (invites, video text, offer titles, files, commits, analysed code). */
// plan_day carries calendar invites; local_transcribe the words in any audio/video file he points it at.
const STORED_OUTSIDE = ["calendar_events", "ideas_list", "wishlist", "git_summary", "vault_read", "vault_search", "vault_skill", "ws_read", "plan_day", "local_transcribe"];
// mission_status: agents' results; run_niche: its web research.
export const UNTRUSTED = ["browse", "fetch_url", "scrape_page", "read_news", "web_search", "ws_fetch_image", "ws_inspire_image", "reach_read", "reach_trending", "find_outliers", "ask_agent", "business_status", "watch_changes", "mission_status", "run_niche", ...STORED_OUTSIDE];
const AGENT_ASK = /\b(ask|have|get|let|tell|send|delegate|hand|use|put)\b[^.?!\n]{0,40}\b(agents?|nova|atlas|pulse|echo|forge|vector|sentinel|flow|qa)\b|\bdelegat/i;
const AGENT_ASK_ET = et("(?:küsi|lase|palu|saada|anna|kasuta|delegeeri)[^.?!\\n]{0,40}(?:agent|nova|atlas|pulse|echo|forge|vector|sentinel|flow|qa)|delegeeri");
/** ask_agent after untrusted content: only when the owner's own message asks for an agent (or names the one being asked). */
export function agentBlocked(question: string, agent: unknown, untrusted: boolean): string {
  if (!untrusted) return "";
  const name = typeof agent === "string" ? agent.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") : "";
  if (AGENT_ASK.test(question) || AGENT_ASK_ET.test(question) || (name && new RegExp(`\\b${name}\\b`, "i").test(question))) return "";
  return "after outside content (pages, news, mail, agent results), ask an agent only when the user asks for one in their latest message";
}

const called = (steps: string[], tools: string[]) => steps.some((s) => tools.some((t) => s.startsWith(`You called ${t} `)));
/** outside text in this answer: the untrusted tools above or any plugin's result (plugins-pure resultText) */
const untrustedIn = (steps: string[], except: readonly string[] = []) => called(steps, UNTRUSTED.filter((t) => !except.includes(t))) || steps.some((s) => s.startsWith("You called plugin__"));
/** This turn read outside text: later turns of the chat count it as still there (core.ts outsideEarlier). */
export const outsideTextIn = (steps: string[]) => untrustedIn(steps);
const err = (s: string | null | undefined) => (s ? s.replace(/^Error: /, "") : "");

// Operator mode (AGENTS.md rule 6, owner-granted 2026-10-30): with the category's Profile → Autonomy area at "do" (the default),
// these tools skip the "only when the user asks in their latest message / as your first tool" check. Never after outside text
// (pages, news, mail, agent results) or attached files in this turn: injected text still can't start work or persist itself.
export const OPERATOR_TOOLS: Record<string, Area> = {
  ask_agent: "operator-build", start_mission: "operator-build", create_goal: "operator-build", queue_tonight: "operator-build",
  save_memory: "operator-organize", vault_move: "operator-organize", vault_rename: "operator-organize", lead_create: "operator-organize", lead_update: "operator-organize",
  life_plan: "operator-organize", automation_create: "operator-organize", automation_pause: "operator-organize",
};
export const OPERATOR_REASON = "standing operator grant";
/** After reading his own stores the grant still applies when HIS typed message asks for this kind of action ("read my notes and
 *  set a goal"): the read is his means, not the source of the instruction. Text inside the results never counts as asking. */
const BUILD_ASKS: Record<string, RegExp> = { create_goal: /\bgoals?\b|eesmär/i, queue_tonight: /\btonight\b|öösel|täna öö/i, start_mission: /\bmissions?\b|missioon/i };
// His explicit "no" for one kind of action ("don't save this", "don't ask an agent", "set a goal but don't create an automation").
// A denial reaches only the action it names; "don't do it (yet)" / "don't do anything" reaches every write. EN + ET.
// "no new goals yet" / "not a goal": a plain no/not reaches only the next two words (a comma ends it: "no idea, set a goal" asks).
const NEG = String.raw`(?:\b(?:don't|dont|do not|never|no need to|without)\b(?!\s+(?:forget|miss|hesitate)\b)(?:\s+[\w'-]+){0,4}?|\b(?:no|not)\b(?:\s+[\w'-]+){0,2}?)\s+`;
const ET_NEG = String.raw`(?<!\p{L})(?:ära|ärge|ärme|ärgu|mitte|ei (?:taha|soovi|ole vaja)|pole vaja|ei taha,? et)(?!\p{L})(?:\s+\S+){0,3}?\s*`; // \b is ASCII-only: "ära" needs \p{L}
const DENY: Record<string, [string, string]> = {
  save_memory: [String.raw`(?:sav|remember|memori[sz]|stor|record|note|keep|log)`, String.raw`(?:salvest|jäta|meelde|mäleta)`],
  ask_agent: [String.raw`(?:ask|use|involve|delegat|hand|send|get)\b.{0,30}?\b(?:agents?|atlas|nova|forge|scout|sage|anyone)|delegat|agents?\b`, String.raw`(?:agent|delegeeri|küsi)`],
  create_goal: [String.raw`(?:goals?\b|target)`, String.raw`eesmär`],
  queue_tonight: [String.raw`(?:tonight|queue|overnight|night shift)`, String.raw`(?:öö|järjekorda)`],
  start_mission: [String.raw`missions?\b`, String.raw`missioon`],
  automation_create: [String.raw`(?:automat|recurring|schedul|every (?:day|week|morning))`, String.raw`(?:automaat|ajasta|iga päev)`],
};
const DENY_ALL = /\b(?:don'?t|do not)\s+(?:do|start|run|act on|make|change)\s+(?:it|that|this|anything|any of (?:it|that|this))\b|\bdon'?t do anything\b|(?<!\p{L})(?:ära|ärge) (?:tee|muuda|tehke) (?:seda|midagi)(?!\p{L})|(?<!\p{L})(?:ära|ärge)\s*!|^\s*(?:ei|ära)\s*[.!]?\s*$/iu;
/** Curly apostrophes (phone keyboards) read like straight ones. */
const plain = (q: string) => q.replace(/[‘’ʼ`]/g, "'");
export function denied(tool: string, question: string): boolean {
  const q = plain(typedText(question)), d = DENY[tool];
  return DENY_ALL.test(q) || (!!d && (new RegExp(`${NEG}(?:${d[0]})`, "i").test(q) || new RegExp(`${ET_NEG}(?:${d[1]})`, "iu").test(q)));
}
// A clause asks for something when it isn't a question: "what goals do my notes mention?" names goals but asks for nothing.
// A polite ask ("can you set a goal?", "kas sa saaksid …") is an ask. Each sentence is judged on its own.
const EN_QUESTION = /^(?:hey orbit\W*)?(?:what|what's|whats|which|who|whose|when|where|why|how|is|are|was|were|do|does|did|have|has|had|am|any|anything)\b/i;
const POLITE = /^(?:hey orbit\W*)?(?:(?:can|could|would|will) (?:you|u)|please|pls)\b/i;
const asking = (s: string) => POLITE.test(s.trim()) || (!/\?\s*$/.test(s) && !EN_QUESTION.test(s.trim()) && !etQuestion(s)) || (/^\s*(?:hei\s+orbit\W*)?kas (?:sa |te )?(?:saad|saaksid|saate|saaksite|võid|võiksid|võite|võiksite|palun)/iu.test(s));
export const requestsIn = (q: string) => (q.match(/[^.?!\n]+[.?!]*/g) ?? []).filter(asking).join(" ");
function ownerAsked(tool: string, question: string): boolean {
  if (denied(tool, question)) return false;
  const q = requestsIn(plain(typedText(question))); // questions and retrieved text never count as asking
  if (tool === "ask_agent") return AGENT_ASK.test(q) || AGENT_ASK_ET.test(q);
  if (tool === "save_memory") return asksToRemember(q);
  if (isOpsTool(tool)) return opsAsked(tool, q);
  return !!BUILD_ASKS[tool]?.test(q);
}
export function operatorAllows(tool: string, ctx: Pick<PolicyCtx, "stopAll" | "attach" | "steps" | "autonomy" | "outsideEarlier"> & { question?: string }): boolean {
  const area = OPERATOR_TOOLS[tool];
  if (!area || ctx.stopAll || ctx.attach) return false;
  if (untrustedIn(ctx.steps, STORED_OUTSIDE)) return false; // pages, news, agents, plugins: never, as before
  if ((ctx.outsideEarlier || called(ctx.steps, STORED_OUTSIDE)) && !ownerAsked(tool, ctx.question ?? "")) return false; // his stores, or an earlier turn's outside text: only when he asked
  const l = ctx.autonomy?.[area];
  return (l ?? AREA_INFO[area].def) === "do";
}

/** Plugin tools called this turn that are local or of unknown locality: they may have read his Journal, so their output is private. */
export const localPluginReads = (ctx: Pick<PolicyCtx, "steps" | "plugins">) => ctx.steps.map((s) => s.slice(11, s.indexOf(" ", 11))).filter((t) => isPluginTool(t) && ctx.plugins?.[t]?.local !== false);
/** Private tools for egress checks: his modules plus any local plugin read this turn. */
export const privateToolsIn = (ctx: PolicyCtx) => [...(ctx.privateTools ?? PRIVATE_TOOLS), ...localPluginReads(ctx)];
/** This turn put private data in context: the chat stays tainted on later turns (core.ts saves it in coreTaintStore). */
export const carriesPrivate = (ctx: PolicyCtx) => ctx.attach || ctx.pins || called(ctx.steps, privateToolsIn(ctx));

export const UNKNOWN_TAINT = "this chat held private data before ORBIT restarted and that text is no longer known here, so plugins and outbound tools are refused in it; a new chat starts clean";
/** Earlier turns' private text by hash: the outgoing phrase found, or "". Local targets skip local-plugin text (local → local is free). */
const carriedHit = (input: Record<string, unknown> | undefined, ctx: PolicyCtx, local: boolean, question: string) =>
  hashLeak(outgoing(input ?? {}), [...(ctx.carriedHashes ?? []), ...(local ? [] : ctx.carriedLocalHashes ?? [])], Buffer.from(ctx.hashKey ?? ""), question);

/** Any private source in context (modules, attachments, pins, carried text, local-plugin output): the card warns it may be journal/LIFE. */
const anyPrivate = (ctx: PolicyCtx) => ctx.attach || ctx.pins || !!ctx.carried || !!ctx.privateText?.length || !!ctx.localText?.length || called(ctx.steps, privateToolsIn(ctx));
export const NO_MODEL_ONCE = "Journal/LIFE text never goes to a model (owner rule), and any private text here may be from it, so this call can't be allowed once; retry without that text";

/** decide() plus "Allow once": an egress refusal offers the owner's card; a call he allowed runs every other check again, then uses it up. */
export function decide(tool: string, input: Record<string, unknown> | undefined, ctx: PolicyCtx): Decision {
  const d = decideRaw(tool, input, { ...ctx, egressAllowed: false });
  const once = ctx.allowOnce;
  if (d.allow || !d.egress) return d;
  // model-bound tools never get private text, not even with his click (AGENTS.md rule 6): attachments, pins and local-plugin
  // output count too, since any of them may hold journal/LIFE text
  if (EGRESS_CLASS[tool] === "model") return { ...d, egress: false, reason: `${d.reason}. ${NO_MODEL_ONCE}` };
  if (!once) return d;
  if (once.has(tool, input ?? {})) {
    const d2 = decideRaw(tool, input, { ...ctx, egressAllowed: true });
    if (!d2.allow) return d2;
    return once.take(tool, input ?? {}) ? { ...d2, reason: "allowed once by the owner's click" } : d; // grant gone in between: refuse
  }
  return { ...d, reason: `${d.reason}. The owner can click Allow once on this refusal; then the identical call may run one time`, allowOnce: once.offer(tool, input ?? {}, anyPrivate(ctx)) };
}

function decideRaw(tool: string, input: Record<string, unknown> | undefined, ctx: PolicyCtx): Decision {
  if (isPluginTool(tool)) { // MCP plugins: tier from annotations + his trust settings, private-text check on every argument (plugins-pure.ts)
    // a local plugin (files, vault) may have read his Journal: its output is private for a remote plugin; unknown locality fails closed
    const local = !!ctx.plugins?.[tool]?.local; // local → local (read notes, then save them) stays allowed across turns
    const priv = local ? [...(ctx.privateTools ?? PRIVATE_TOOLS)] : privateToolsIn(ctx), carriedLocal = local ? [] : ctx.localText ?? [];
    // the taint also stands for journal/LIFE/ws_read/attachment text; a local target ignores it only when carried local-plugin text explains it
    if (!ctx.plugins?.[tool]) return pluginDecision(tool, input, undefined, { stopAll: ctx.stopAll, privateIn: true, question: "", outside: true, privateTexts: [] }); // unknown: plain refusal, no card
    if (ctx.egressAllowed) return pluginDecision(tool, input, ctx.plugins?.[tool], { stopAll: ctx.stopAll, privateIn: false, question: typedText(ctx.question), outside: outsideIn(ctx.steps, UNTRUSTED, ctx.plugins ?? {}, ctx.attach), privateTexts: [] });
    if (ctx.carried && ctx.carriedKind === "unknown" && !ctx.stopAll) return { allow: false, tier: ctx.plugins?.[tool]?.tier ?? "T3", reason: UNKNOWN_TAINT, egress: true };
    const hit = ctx.carried ? carriedHit(input, ctx, local, typedText(ctx.question)) : "";
    if (hit && !ctx.stopAll && ctx.plugins?.[tool]) return { allow: false, tier: ctx.plugins[tool].tier, reason: `this plugin call would carry private text out of ORBIT: "${hit.slice(0, 80)}". Retry without it`, egress: true };
    // a known kind decides for a local target: "private" (journal/LIFE/files) is checked, "local" (only local-plugin output) is free
    const carriedPriv = !!ctx.carried && (!local || (ctx.carriedKind ? ctx.carriedKind === "private" : !ctx.localText?.length));
    const privateIn = ctx.attach || ctx.pins || carriedPriv || !!ctx.privateText?.length || !!carriedLocal.length || called(ctx.steps, priv);
    return pluginDecision(tool, input, ctx.plugins?.[tool], { stopAll: ctx.stopAll, privateIn, question: typedText(ctx.question), outside: outsideIn(ctx.steps, UNTRUSTED, ctx.plugins ?? {}, ctx.attach),
      privateTexts: [...(ctx.privateText ?? []), ...carriedLocal, ...privateResults(ctx.steps, priv)] });
  }
  const tier = TIERS[tool] ?? "T3"; // unknown = fail closed
  const no = (reason: string): Decision => ({ allow: false, tier, reason });
  if (!(tool in TIERS)) return no(`unknown tool "${tool}"`);
  const question = typedText(ctx.question); // core.ts:95 attached file names never count as the user's words
  if (tier !== "T0" && denied(tool, question)) return no("he said not to do this in his message"); // his "don't" beats every grant and ask-check
  const dataIn = ctx.attach || ctx.pins || ctx.steps.some((s) => !s.startsWith("You called navigate")); // core.ts:139
  const privateIn = !!ctx.carried || called(ctx.steps, privateToolsIn(ctx)); // core.ts:146; CORE passes its live MODULE_PRIVATE, plus local plugin reads

  const stop = err(coreToolRefusal(ctx.stopAll, tool)); // core.ts:218
  if (stop) return no(stop);
  const area = TOOL_AREA[tool], auto = area ? autonomyAllows(area, "owner", { levels: ctx.autonomy }) : null;
  if (auto && !auto.ok) return no(auto.why);
  if (tool === "navigate") return dataIn ? no("navigate only as your first tool call, for the user's own request") : { allow: true, tier, reason: "first tool call" }; // core.ts:218 + 265
  // Web and agent tools stay on with private data in context; only a call whose outgoing query/URL/brief carries a piece of it is refused.
  if (!ctx.egressAllowed && (ctx.attach || ctx.pins || privateIn || !!ctx.privateText?.length || !!ctx.localText?.length) && (LEAK_TOOLS.includes(tool) || LINK_TOOLS.includes(tool))) {
    const texts = [...(ctx.privateText ?? []), ...(ctx.localText ?? []), ...privateResults(ctx.steps, privateToolsIn(ctx))];
    if (ctx.carried && ctx.carriedKind === "unknown") return { ...no(UNKNOWN_TAINT), egress: true };
    const hit = outboundLeak(outgoing(input ?? {}), texts, question, !texts.length) || (ctx.carried ? carriedHit(input, ctx, false, question) : "");
    if (hit) return { ...no(`this ${tool} call would send private text out: "${hit.slice(0, 80)}" (from the user's private notes, journal or files). The tool is allowed: retry with a generic query/brief without that text, and if you can't, tell the user exactly which text blocked it; never tell the user to do the search himself`), egress: true };
  }

  if (tier === "T3" && !APPROVAL_PATHS[tool]) return no("acts outside ORBIT with no owner approval path; the owner does this from its panel");

  // Explicit-ask writes: each module's own guard, fed the taint core.ts/core-modules.ts gives it (core.ts:223, core-modules.ts:26-77).
  let blocked = "";
  if ((STUDIO_TOOLS as readonly string[]).includes(tool) || tool === "plan_task") blocked = actionBlocked(tool as StudioTool, question, dataIn);
  else if ((LIFE_TOOLS as readonly string[]).includes(tool)) blocked = err(lifeWriteBlocked(tool as LifeTool, question, dataIn));
  else if (tool === "ws_write" || tool === "ws_create" || tool === "ws_fetch_image" || tool === "ws_inspire_image" || tool === "ws_picture_draft") blocked = err(wsWriteBlocked(question, ctx.attach || ctx.pins || wsTainted(ctx.steps, question), { ...ctx.ws, target: tool !== "ws_create" ? input?.workspace : input?.name })); // core-modules.ts:50
  else if (tool === "create_goal") blocked = createGoalBlocked(question, dataIn);
  else if (tool === "higgsfield_draft") blocked = draftBlocked(question, dataIn);
  else if (tool === "queue_tonight") blocked = tonightBlocked(question, dataIn);
  else if (tool === "add_wish") blocked = wishBlocked(question, dataIn);
  else if (tool === "propose_rule") blocked = ruleBlocked(question, dataIn);
  else if (tool === "watch_add") blocked = watchBlocked(question, dataIn);
  else if (tool === "ask_agent") blocked = agentBlocked(question, input?.agent, ctx.attach || untrustedIn(ctx.steps));
  else if (tool === "save_decision" && input?.confirmed === true) blocked = !dataIn && !privateIn && confirmsDecision(typedText(question)) ? "" : "save a decision only after his latest message is a plain yes to the preview"; // the preview call writes nothing
  else if (tool === "save_checkpoint") blocked = checkpointBlocked(question);
  else if (isOpsTool(tool)) { if (ctx.stopAll) return no(PAUSED_MSG); blocked = opsBlocked(tool, question, dataIn, input, ctx.attach || ctx.pins ? [] : [...createdLeads(ctx.steps), ...(ctx.ownLeads ?? [])]) ?? ""; } // Stop-all halts operator writes outright
  else if (tool === "save_memory" && !asksToRemember(question)) blocked = "only save when the user asks; reflection handles the rest"; // core.ts:287
  if (blocked && operatorAllows(tool, ctx)) return { allow: true, tier, reason: OPERATOR_REASON };
  if (blocked) return no(blocked);
  return { allow: true, tier, reason: "allowed" };
}

/** The ledger's policy.decision payload, T2/T3 only: tool, tier, verdict and the guard's fixed reason; never inputs or message text. */
export const policyEvent = (tool: string, d: Decision) =>
  d.tier === "T2" || d.tier === "T3" ? { tool: /^unknown (?:plugin )?tool /.test(d.reason) ? "unknown" : tool.slice(0, 128), /* never a model-chosen name */ tier: d.tier, verdict: d.allow ? "allow" : "refuse", reason: d.reason.replace(/"[^"]*"/g, '"…"').slice(0, 300) } : null;

