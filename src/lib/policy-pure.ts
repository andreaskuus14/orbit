// CORE tool permission policy: every CORE tool call passes decide() before it runs (core.ts tool dispatch); T2/T3 verdicts go to the ledger.
// "core.ts:NNN" refs point at the inline guards this replaced (core.ts at fb313a4); tests/policy.test.ts pins decide() to them.
// Tiers: T0 read own data, T1 read the public web, T2 change own data, T3 act on the outside world (owner-approved only, AGENTS.md rule 6).
import { coreToolRefusal } from "./stop-all-pure.ts";
import { foreignUrl, typedText } from "./attach-pure.ts";
import { actionBlocked, STUDIO_TOOLS, type StudioTool } from "./core-studio.ts";
import { LIFE_TOOLS, lifeWriteBlocked, type LifeTool } from "./core-life.ts";
import { WS_TOOLS, wsTainted, wsWriteBlocked } from "./core-workspace.ts";
import { createGoalBlocked } from "./goals-pure.ts";
import { asksToRemember } from "./reflect-pure.ts";
import { draftBlocked } from "./higgsfield-pure.ts";
import { tonightBlocked } from "./night-pure.ts";
import { wishBlocked } from "./deals-pure.ts";
import { ruleBlocked } from "./rules-pure.ts";
import { autonomyAllows, type Area, type Levels } from "./autonomy-pure.ts";
import { et } from "./et-ask-pure.ts";

export type Tier = "T0" | "T1" | "T2" | "T3";
export type Decision = { allow: boolean; tier: Tier; reason: string };
/** stopAll: Stop-all switch; attach: files attached this turn; pins: pinned project notes in context;
 *  steps: this answer's tool results so far, in core.ts's "You called <tool> <json>\nRESULT:\n..." form; question: latest user message. */
export type PolicyCtx = { stopAll: boolean; attach: boolean; pins: boolean; steps: string[]; question: string; privateTools?: readonly string[]; autonomy?: Partial<Levels> };

export const TIERS: Record<string, Tier> = {
  navigate: "T0", goal_status: "T0", mission_status: "T0", business_status: "T0", ideas_list: "T0",
  studio_status: "T0", learned: "T0", suggestions: "T0",
  life_status: "T0", life_journal: "T0", vault_search: "T0", vault_read: "T0", calendar_events: "T0", plan_day: "T0", git_summary: "T0",
  ws_list: "T0", ws_read: "T0", rea_status: "T0", rea_read: "T0", week_review: "T0", wishlist: "T0",
  load_module: "T1", // returns a module's own instruction text (core-modules-pure loadModule)
  web_search: "T1", fetch_url: "T1", read_news: "T1", reach_trending: "T1", reach_read: "T1",
  save_memory: "T2", ask_agent: "T2", create_goal: "T2", start_mission: "T2", plan_task: "T2", run_scout: "T2", run_niche: "T2",
  propose_rule: "T2", // saves a standing rule as proposed; nothing runs until the owner's Confirm click in Agents → Rules
  add_wish: "T2", // adds to his own wishlist; the hunter only reads public pages, and nothing is bought or sent by ORBIT
  queue_tonight: "T2", // adds to the night shift's own queue; the night run's outside effects still wait for owner approvals
  life_check: "T2", life_add_habit: "T2", life_remind: "T2", ws_write: "T2", ws_create: "T2", rea_analyze: "T2", rea_cancel: "T2",
  schedule_approved: "T3", // uploads owner-approved clips to YouTube
  higgsfield_draft: "T3", // proposes a Higgsfield spend (price check only); the spend itself is the owner's story.approve click
};

// T3 runs only behind an owner-click approval (AGENTS.md rule 6): the token each path checks before anything leaves ORBIT.
export const APPROVAL_PATHS: Record<string, string> = {
  schedule_approved: 'clip.status "approved" from the owner\'s Approve click in STUDIO review; scheduleAll uploads only those clips',
  higgsfield_draft: "never spends: it saves a draft and asks Higgsfield the price (hf-guard quote mode, get_cost only); credits are spent only by the owner's Approve click on that quote in Clip Factory → AI Story (story.approve)",
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
  create_goal: "goals", queue_tonight: "night-shift", add_wish: "deals", schedule_approved: "studio-publish", higgsfield_draft: "higgsfield-spend",
};

// Mirror of core-modules.ts privateTools(MODULES): LIFE (private: true), WORKSPACE ws_read, REA rea_read, BUSINESS (private: true), WEEK (private: true).
// shortcut: hand-copied because core-modules.ts can't load under node --test; update both when a module's private flag changes.
export const PRIVATE_TOOLS = [...LIFE_TOOLS, "ws_read", "rea_read", "business_status", "week_review"];
const LINK_TOOLS = ["fetch_url", "read_news", "ask_agent", "reach_read"];
const LEAK_TOOLS = ["ask_agent", "read_news", "web_search"];

// Text from outside ORBIT (pages, news, search hits, agent results, prospect mail, attached files) can't start an agent task by itself.
const UNTRUSTED = ["fetch_url", "read_news", "web_search", "reach_read", "reach_trending", "ask_agent", "business_status"];
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

export function decide(tool: string, input: Record<string, unknown> | undefined, ctx: PolicyCtx): Decision {
  const tier = TIERS[tool] ?? "T3"; // unknown = fail closed
  const no = (reason: string): Decision => ({ allow: false, tier, reason });
  if (!(tool in TIERS)) return no(`unknown tool "${tool}"`);
  const question = typedText(ctx.question); // core.ts:95 attached file names never count as the user's words
  const dataIn = ctx.attach || ctx.pins || ctx.steps.some((s) => !s.startsWith("You called navigate")); // core.ts:139
  const privateIn = called(ctx.steps, [...(ctx.privateTools ?? PRIVATE_TOOLS)]); // core.ts:146; CORE passes its live MODULE_PRIVATE

  const stop = err(coreToolRefusal(ctx.stopAll, tool)); // core.ts:218
  if (stop) return no(stop);
  const area = TOOL_AREA[tool], auto = area ? autonomyAllows(area, "owner", { levels: ctx.autonomy }) : null;
  if (auto && !auto.ok) return no(auto.why);
  if (tool === "navigate") return dataIn ? no("navigate only as your first tool call, for the user's own request") : { allow: true, tier, reason: "first tool call" }; // core.ts:218 + 265
  if (ctx.attach && tool === "web_search") return no("with the user's attached files in context, web search is off for this answer (the search words could carry their text out)"); // core.ts:219
  if ((ctx.pins || privateIn) && LEAK_TOOLS.includes(tool)) return no("the user's private files, journal or pinned notes are in context; agents, news and web searches are off for the rest of this answer (they could carry that text out)"); // core.ts:220
  if ((ctx.attach || ctx.pins || privateIn) && LINK_TOOLS.includes(tool) && foreignUrl(input ?? {}, question)) return no("with the user's files in context, only open links the user typed in their message"); // core.ts:221

  if (tier === "T3" && !APPROVAL_PATHS[tool]) return no("acts outside ORBIT with no owner approval path; the owner does this from its panel");

  // Explicit-ask writes: each module's own guard, fed the taint core.ts/core-modules.ts gives it (core.ts:223, core-modules.ts:26-77).
  let blocked = "";
  if ((STUDIO_TOOLS as readonly string[]).includes(tool) || tool === "plan_task") blocked = actionBlocked(tool as StudioTool, question, dataIn);
  else if ((LIFE_TOOLS as readonly string[]).includes(tool)) blocked = err(lifeWriteBlocked(tool as LifeTool, question, dataIn));
  else if (tool === "ws_write" || tool === "ws_create") blocked = err(wsWriteBlocked(question, ctx.attach || ctx.pins || wsTainted(ctx.steps))); // core-modules.ts:50
  else if (tool === "create_goal") blocked = createGoalBlocked(question, dataIn);
  else if (tool === "higgsfield_draft") blocked = draftBlocked(question, dataIn);
  else if (tool === "queue_tonight") blocked = tonightBlocked(question, dataIn);
  else if (tool === "add_wish") blocked = wishBlocked(question, dataIn);
  else if (tool === "propose_rule") blocked = ruleBlocked(question, dataIn);
  else if (tool === "ask_agent") blocked = agentBlocked(question, input?.agent, ctx.attach || called(ctx.steps, UNTRUSTED));
  else if (tool === "save_memory" && !asksToRemember(question)) blocked = "only save when the user asks; reflection handles the rest"; // core.ts:287
  if (blocked) return no(blocked);
  // shortcut: rea_analyze/rea_cancel keep their explicit-ask check inside REA code (not ported: REA files stay untouched).
  return { allow: true, tier, reason: tool.startsWith("rea_") && tier === "T2" ? "allowed here; REA's own guard still applies" : "allowed" };
}

/** The ledger's policy.decision payload, T2/T3 only: tool, tier, verdict and the guard's fixed reason; never inputs or message text. */
export const policyEvent = (tool: string, d: Decision) =>
  d.tier === "T2" || d.tier === "T3" ? { tool: tool.slice(0, 128), tier: d.tier, verdict: d.allow ? "allow" : "refuse", reason: d.reason.slice(0, 300) } : null;
