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
import { checkpointBlocked } from "./checkpoint-pure.ts";
import { draftBlocked } from "./higgsfield-pure.ts";
import { tonightBlocked } from "./night-pure.ts";
import { wishBlocked } from "./deals-pure.ts";
import { ruleBlocked } from "./rules-pure.ts";
import { AREA_INFO, autonomyAllows, type Area, type Levels } from "./autonomy-pure.ts";
import { et } from "./et-ask-pure.ts";
import { createdLeads, isOpsTool, opsBlocked } from "./core-operator-pure.ts";
import { outboundLeak, outgoing, privateResults } from "./outbound-pure.ts";

export type Tier = "T0" | "T1" | "T2" | "T3";
export type Decision = { allow: boolean; tier: Tier; reason: string };
/** stopAll: Stop-all switch; attach: files attached this turn; pins: pinned project notes in context;
 *  steps: this answer's tool results so far, in core.ts's "You called <tool> <json>\nRESULT:\n..." form; question: latest user message. */
export type PolicyCtx = { stopAll: boolean; attach: boolean; pins: boolean; steps: string[]; question: string; privateTools?: readonly string[]; autonomy?: Partial<Levels>;
  /** an earlier turn of this chat had private data in context (journal/LIFE, attachments, pins): it is still in the session (C03) */
  carried?: boolean;
  /** private text in this turn's context besides tool results (attachments, pinned notes, an earlier turn's private results): outbound calls are checked against it */
  privateText?: readonly string[];
  /** workspace names + CORE's pending build offer in this chat (ws-intent-pure.ts) */
  ws?: WsGate;
  /** leads CORE added in this chat on earlier turns (core-operator-pure ownLeadsIn); this turn's come from steps */
  ownLeads?: readonly string[] };

export const TIERS: Record<string, Tier> = {
  navigate: "T0", goal_status: "T0", mission_status: "T0", business_status: "T0", ideas_list: "T0",
  studio_status: "T0", learned: "T0", suggestions: "T0",
  life_status: "T0", life_journal: "T0", vault_search: "T0", vault_read: "T0", calendar_events: "T0", plan_day: "T0", git_summary: "T0",
  ws_list: "T0", ws_read: "T0", rea_status: "T0", rea_read: "T0", week_review: "T0", wishlist: "T0",
  load_module: "T1", // returns a module's own instruction text (core-modules-pure loadModule)
  read_more: "T1", // rereads a clipped result already in this turn (clip-store-pure)
  web_search: "T1", fetch_url: "T1", read_news: "T1", reach_trending: "T1", reach_read: "T1",
  save_memory: "T2", ask_agent: "T2", create_goal: "T2", start_mission: "T2", plan_task: "T2", run_scout: "T2", run_niche: "T2",
  propose_rule: "T2", // saves a standing rule as proposed; nothing runs until the owner's Confirm click in Agents → Rules
  add_wish: "T2", // adds to his own wishlist; the hunter only reads public pages, and nothing is bought or sent by ORBIT
  save_checkpoint: "T2", // his own chat checkpoint (local file); every line can be edited or deleted on the Checkpoint card
  queue_tonight: "T2", // adds to the night shift's own queue; the night run's outside effects still wait for owner approvals
  life_check: "T2", life_add_habit: "T2", life_remind: "T2", ws_write: "T2", ws_create: "T2", ws_fetch_image: "T2", ws_run: "T2", ws_stop: "T2", rea_analyze: "T2", rea_cancel: "T2",
  vault_move: "T2", vault_rename: "T2", lead_create: "T2", lead_update: "T2", life_plan: "T2", automation_create: "T2", automation_pause: "T2", // ORGANIZE: his own records, each with Undo
  schedule_approved: "T3", // uploads owner-approved clips to YouTube
  higgsfield_draft: "T3", // proposes a Higgsfield spend (price check only); the spend itself is the owner's story.approve click
  ws_picture_draft: "T3", // stand-in art at the site's image paths + one priced draft per site; the spend is the owner's story.approve click
  studio_drafts: "T0", // lists STUDIO's drafts and their state
  ws_inspire_image: "T3", // reference words from an image search, then the same priced draft as higgsfield_draft for an original brief
  local_3d: "T2", local_tts: "T2", local_transcribe: "T2", // free models on his own PC (tools/local-ai); the result is a new VAULT file, nothing leaves the PC
  roblox_export: "T2", // rojo syncback into his own projects folder + a local git commit (tools/roblox); nothing leaves the PC
  roblox_lint: "T0", // selene on his exported project, read-only
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
  local_3d: "operator-build", local_tts: "operator-build", local_transcribe: "operator-build", // local models writing new VAULT files (category A)
  roblox_export: "operator-build", // local project files + git commit (category A)
};

// Mirror of core-modules.ts privateTools(MODULES): LIFE (private: true), WORKSPACE ws_read, REA rea_read, BUSINESS (private: true), WEEK (private: true), ORGANIZE lead_update + life_plan.
// shortcut: hand-copied because core-modules.ts can't load under node --test; update both when a module's private flag changes.
export const PRIVATE_TOOLS = [...LIFE_TOOLS, "ws_read", "rea_read", "business_status", "week_review", "lead_update", "life_plan"];
const LINK_TOOLS = ["fetch_url", "read_news", "ask_agent", "reach_read", "ws_fetch_image", "ws_inspire_image", "ws_picture_draft"];
const LEAK_TOOLS = ["ask_agent", "read_news", "web_search", "local_tts"]; // local_tts: journal/LIFE text never goes to a model, local ones included

// Text from outside ORBIT (pages, news, search hits, agent results, prospect mail, attached files) can't start an agent task by itself.
const UNTRUSTED = ["fetch_url", "read_news", "web_search", "ws_fetch_image", "ws_inspire_image", "reach_read", "reach_trending", "ask_agent", "business_status"];
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
export function operatorAllows(tool: string, ctx: Pick<PolicyCtx, "stopAll" | "attach" | "steps" | "autonomy">): boolean {
  const area = OPERATOR_TOOLS[tool];
  if (!area || ctx.stopAll || ctx.attach || called(ctx.steps, UNTRUSTED)) return false;
  const l = ctx.autonomy?.[area];
  return (l ?? AREA_INFO[area].def) === "do";
}

/** This turn put private data in context: the chat stays tainted on later turns (core.ts saves it in coreTaintStore). */
export const carriesPrivate = (ctx: PolicyCtx) => ctx.attach || ctx.pins || called(ctx.steps, [...(ctx.privateTools ?? PRIVATE_TOOLS)]);

export function decide(tool: string, input: Record<string, unknown> | undefined, ctx: PolicyCtx): Decision {
  const tier = TIERS[tool] ?? "T3"; // unknown = fail closed
  const no = (reason: string): Decision => ({ allow: false, tier, reason });
  if (!(tool in TIERS)) return no(`unknown tool "${tool}"`);
  const question = typedText(ctx.question); // core.ts:95 attached file names never count as the user's words
  const dataIn = ctx.attach || ctx.pins || ctx.steps.some((s) => !s.startsWith("You called navigate")); // core.ts:139
  const privateIn = !!ctx.carried || called(ctx.steps, [...(ctx.privateTools ?? PRIVATE_TOOLS)]); // core.ts:146; CORE passes its live MODULE_PRIVATE

  const stop = err(coreToolRefusal(ctx.stopAll, tool)); // core.ts:218
  if (stop) return no(stop);
  const area = TOOL_AREA[tool], auto = area ? autonomyAllows(area, "owner", { levels: ctx.autonomy }) : null;
  if (auto && !auto.ok) return no(auto.why);
  if (tool === "navigate") return dataIn ? no("navigate only as your first tool call, for the user's own request") : { allow: true, tier, reason: "first tool call" }; // core.ts:218 + 265
  // Web and agent tools stay on with private data in context; only a call whose outgoing query/URL/brief carries a piece of it is refused.
  if ((ctx.attach || ctx.pins || privateIn) && (LEAK_TOOLS.includes(tool) || LINK_TOOLS.includes(tool))) {
    const texts = [...(ctx.privateText ?? []), ...privateResults(ctx.steps, ctx.privateTools ?? PRIVATE_TOOLS)];
    const hit = outboundLeak(outgoing(input ?? {}), texts, question, !texts.length);
    if (hit) return no(`this ${tool} call would send private text out: "${hit.slice(0, 80)}" (from the user's private notes, journal or files). The tool is allowed: retry with a generic query/brief without that text, and if you can't, tell the user exactly which text blocked it; never tell the user to do the search himself`);
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
  else if (tool === "ask_agent") blocked = agentBlocked(question, input?.agent, ctx.attach || called(ctx.steps, UNTRUSTED));
  else if (tool === "save_checkpoint") blocked = checkpointBlocked(question);
  else if (isOpsTool(tool)) { if (ctx.stopAll) return no(PAUSED_MSG); blocked = opsBlocked(tool, question, dataIn, input, ctx.attach || ctx.pins ? [] : [...createdLeads(ctx.steps), ...(ctx.ownLeads ?? [])]) ?? ""; } // Stop-all halts operator writes outright
  else if (tool === "save_memory" && !asksToRemember(question)) blocked = "only save when the user asks; reflection handles the rest"; // core.ts:287
  if (blocked && operatorAllows(tool, ctx)) return { allow: true, tier, reason: OPERATOR_REASON };
  if (blocked) return no(blocked);
  // shortcut: rea_analyze/rea_cancel keep their explicit-ask check inside REA code (not ported: REA files stay untouched).
  return { allow: true, tier, reason: tool.startsWith("rea_") && tier === "T2" ? "allowed here; REA's own guard still applies" : "allowed" };
}

/** The ledger's policy.decision payload, T2/T3 only: tool, tier, verdict and the guard's fixed reason; never inputs or message text. */
export const policyEvent = (tool: string, d: Decision) =>
  d.tier === "T2" || d.tier === "T3" ? { tool: tool.slice(0, 128), tier: d.tier, verdict: d.allow ? "allow" : "refuse", reason: d.reason.replace(/"[^"]*"/g, '"…"').slice(0, 300) } : null;
