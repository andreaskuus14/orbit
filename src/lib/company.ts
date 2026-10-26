import type { SupabaseClient } from "@supabase/supabase-js";
import { createChain, listChains } from "./chains";
import { stopAllOn } from "./stop-all";
import { usageLimited } from "./usage-meter";
import { scorecardView } from "./agent-replay";
import { REPLAY_CASES } from "../../evals/agent-replay-cases";
import { COMPANY, COMPANY_PREFIX, ROLES, orgChart, planCompany, type TaskRow } from "./company-pure";

// AGENT COMPANY (rules: company-pure.ts). The plan becomes an ordinary AGENT TEAMS chain (chains.ts drive(): one step at a time, results
// handed forward, stops at the approvals queue), so no new model-spend path: every call goes through runTask under the role's budget.

/** Owner's click → the CEO's plan started as a company chain. Returns the chain id and roles, or why not. */
export async function startCompany(sb: SupabaseClient, userId: string, goal: unknown) {
  if (stopAllOn()) return { error: "Stop-all is on" };
  if (usageLimited()) return { error: "Claude usage limit reached" };
  const plan = planCompany(goal);
  if (typeof plan === "string") return { error: plan };
  const r = await createChain(sb, userId, { goal: plan.goal, steps: plan.steps }, true);
  return "error" in r ? r : { ...r, roles: plan.roles };
}

/** Org chart (who did what, last output, scorecard grade) + the newest company chains. */
export async function companyView(sb: SupabaseClient, userId: string) {
  const agents = [...new Set(ROLES.map((r) => COMPANY[r].agent))];
  const [{ data, error }, chains, card, tonight] = await Promise.all([
    sb.from("tasks").select("agent, title, status, result, created_at").eq("user_id", userId).in("agent", agents).order("created_at", { ascending: false }).limit(200),
    listChains(sb, userId), // also resumes running chains, like GET /api/chains
    scorecardView().catch(() => null),
    import("./night").then((n) => n.companyTonight(userId)),
  ]);
  if (error) throw error;
  return {
    seats: orgChart((data ?? []) as TaskRow[], (card?.cases ?? []).map((c) => ({ agent: REPLAY_CASES.find((x) => x.id === c.id)?.agent ?? "", score: c.score }))),
    chains: chains.filter((c) => c.goal.startsWith(COMPANY_PREFIX)).slice(0, 5),
    tonight, // goals queued for the night shift to start
  };
}
