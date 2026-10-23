// CORE tool permission policy: today's runCore guards (src/lib/core.ts lines 139-146 and 218-224) as one pure decide().
// Not wired in yet: core.ts still runs its own checks; tests/policy.test.ts pins this file to that behaviour.
// Tiers: T0 read own data, T1 read the public web, T2 change own data, T3 act on the outside world (owner-approved only, AGENTS.md rule 6).
import { coreToolRefusal } from "./stop-all-pure.ts";
import { foreignUrl, typedText } from "./attach-pure.ts";
import { actionBlocked, STUDIO_TOOLS, type StudioTool } from "./core-studio.ts";
import { LIFE_TOOLS, lifeWriteBlocked, type LifeTool } from "./core-life.ts";
import { WS_TOOLS, wsTainted, wsWriteBlocked } from "./core-workspace.ts";
import { createGoalBlocked } from "./goals-pure.ts";
import { asksToRemember } from "./reflect-pure.ts";

export type Tier = "T0" | "T1" | "T2" | "T3";
export type Decision = { allow: boolean; tier: Tier; reason: string };
/** stopAll: Stop-all switch; attach: files attached this turn; pins: pinned project notes in context;
 *  steps: this answer's tool results so far, in core.ts's "You called <tool> <json>\nRESULT:\n..." form; question: latest user message. */
export type PolicyCtx = { stopAll: boolean; attach: boolean; pins: boolean; steps: string[]; question: string };

export const TIERS: Record<string, Tier> = {
  navigate: "T0", goal_status: "T0", business_status: "T0", ideas_list: "T0",
  studio_status: "T0", learned: "T0", suggestions: "T0",
  life_status: "T0", life_journal: "T0", vault_search: "T0", vault_read: "T0", calendar_events: "T0", git_summary: "T0",
  ws_list: "T0", ws_read: "T0", rea_status: "T0", rea_read: "T0",
  web_search: "T1", fetch_url: "T1", read_news: "T1", reach_trending: "T1", reach_read: "T1",
  save_memory: "T2", ask_agent: "T2", create_goal: "T2", plan_task: "T2", run_scout: "T2", run_niche: "T2",
  life_check: "T2", life_add_habit: "T2", life_remind: "T2", ws_write: "T2", ws_create: "T2", rea_analyze: "T2", rea_cancel: "T2",
  schedule_approved: "T3", // uploads owner-approved clips to YouTube
};

// Mirror of core-modules.ts privateTools(MODULES): LIFE (private: true), WORKSPACE ws_read, REA rea_read, BUSINESS (private: true).
// shortcut: hand-copied because core-modules.ts can't load under node --test; update both when a module's private flag changes.
export const PRIVATE_TOOLS = [...LIFE_TOOLS, "ws_read", "rea_read", "business_status"];
const LINK_TOOLS = ["fetch_url", "read_news", "ask_agent", "reach_read"];
const LEAK_TOOLS = ["ask_agent", "read_news", "web_search"];

const called = (steps: string[], tools: string[]) => steps.some((s) => tools.some((t) => s.startsWith(`You called ${t} `)));
const err = (s: string | null | undefined) => (s ? s.replace(/^Error: /, "") : "");

export function decide(tool: string, input: Record<string, unknown> | undefined, ctx: PolicyCtx): Decision {
  const tier = TIERS[tool] ?? "T3"; // unknown = fail closed
  const no = (reason: string): Decision => ({ allow: false, tier, reason });
  if (!(tool in TIERS)) return no(`unknown tool "${tool}"`);
  const question = typedText(ctx.question); // core.ts:95 attached file names never count as the user's words
  const dataIn = ctx.attach || ctx.pins || ctx.steps.some((s) => !s.startsWith("You called navigate")); // core.ts:139
  const privateIn = called(ctx.steps, PRIVATE_TOOLS); // core.ts:146

  const stop = err(coreToolRefusal(ctx.stopAll, tool)); // core.ts:218
  if (stop) return no(stop);
  if (tool === "navigate") return dataIn ? no("navigate only as your first tool call, for the user's own request") : { allow: true, tier, reason: "first tool call" }; // core.ts:218 + 265
  if (ctx.attach && tool === "web_search") return no("attached files in context: web search could carry their text out"); // core.ts:219
  if ((ctx.pins || privateIn) && LEAK_TOOLS.includes(tool)) return no("private files, journal or pinned notes in context: agents, news and web search are off"); // core.ts:220
  if ((ctx.attach || ctx.pins || privateIn) && LINK_TOOLS.includes(tool) && foreignUrl(input ?? {}, question)) return no("files in context: only links the user typed"); // core.ts:221

  // Explicit-ask writes: each module's own guard, fed the taint core.ts/core-modules.ts gives it (core.ts:223, core-modules.ts:26-77).
  let blocked = "";
  if ((STUDIO_TOOLS as readonly string[]).includes(tool) || tool === "plan_task") blocked = actionBlocked(tool as StudioTool, question, dataIn);
  else if ((LIFE_TOOLS as readonly string[]).includes(tool)) blocked = err(lifeWriteBlocked(tool as LifeTool, question, dataIn));
  else if (tool === "ws_write" || tool === "ws_create") blocked = err(wsWriteBlocked(question, ctx.attach || ctx.pins || wsTainted(ctx.steps))); // core-modules.ts:50
  else if (tool === "create_goal") blocked = createGoalBlocked(question, dataIn);
  else if (tool === "save_memory" && !asksToRemember(question)) blocked = "only save when the user asks; reflection handles the rest"; // core.ts:287
  if (blocked) return no(blocked);
  // shortcut: rea_analyze/rea_cancel keep their explicit-ask check inside REA code (not ported: REA files stay untouched).
  return { allow: true, tier, reason: tool.startsWith("rea_") && tier === "T2" ? "allowed here; REA's own guard still applies" : "allowed" };
}
