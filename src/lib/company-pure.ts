// AGENT COMPANY (pure, tested in tests/company.test.ts). ORBIT's built-in agents presented as a small company. Runner: src/lib/company.ts.
// The CEO is this planner (no model call): it turns one owner goal into a 2-4 step AGENT TEAMS chain (chains-pure.ts), each step capped by
// its role's budget. The chain runner hands each result forward and stops at an approval; nothing here sends, publishes or spends.
import { CHAIN_TITLE, parseMeta, type Draft } from "./chains-pure.ts";

export const ROLES = ["ceo", "researcher", "analyst", "writer", "ops"] as const;
export type Role = (typeof ROLES)[number];
// Claude calls per step (time: createBudget's default 8 minutes). Sources: researcher = a night-shift research task (night-pure planNight: 8);
// writer/analyst/ops = the agent loop's MAX_STEPS (7, agents.ts). The CEO plans in code: 0 calls.
export const COMPANY: Record<Role, { title: string; agent: string; calls: number }> = {
  ceo: { title: "CEO · planner", agent: "nova", calls: 0 },
  researcher: { title: "Researcher", agent: "atlas", calls: 8 },
  analyst: { title: "Analyst", agent: "vector", calls: 7 },
  writer: { title: "Writer", agent: "forge", calls: 7 },
  ops: { title: "Ops", agent: "flow", calls: 7 },
};
export const CHAIN_MAX_CALLS = 40; // one company run never asks for more than a whole night shift (NIGHT_DEFAULTS.maxCalls)
export const COMPANY_PREFIX = "Company: ";

const OUTWARD = "Do not send, post, publish or buy anything. Anything to save, send or schedule must be proposed for the owner's approval.";
const ASK: Record<Exclude<Role, "ceo">, (goal: string) => string> = {
  analyst: (g) => `Pull the owner's real ORBIT numbers that matter for this goal: ${g}\nSmall table plus 2-3 insights. ${OUTWARD}`,
  researcher: (g) => `Research what the owner needs to know for this goal, with sources: ${g}\n${OUTWARD}`,
  writer: (g) => `Write the deliverable for this goal, using the results handed to you: ${g}\nPropose save_memory (kind "document") so the owner can keep it. ${OUTWARD}`,
  ops: (g) => `If part of this goal should repeat, propose ONE automation for it (it waits for the owner's approval); otherwise say no automation is needed: ${g}\n${OUTWARD}`,
};
const has = (re: RegExp, t: string) => re.test(t);

/** The CEO's plan: roles in a fixed order (analyst, researcher, writer, ops), picked by keywords. Always 2-4 steps, within CHAIN_MAX_CALLS. */
export function planCompany(goalIn: unknown): Draft & { roles: Role[] } | string {
  const goal = typeof goalIn === "string" ? goalIn.replace(/\s+/g, " ").trim() : "";
  if (goal.length < 3 || goal.length > 300 - COMPANY_PREFIX.length) return `goal must be 3-${300 - COMPANY_PREFIX.length} characters`;
  const t = goal.toLowerCase();
  const roles: Role[] = [];
  if (has(/\b(my|our)\b.*\b(stats|numbers|activity|performance|tasks)\b|\b(analy[sz]e|metrics|how (much|many))\b/, t)) roles.push("analyst");
  if (has(/\b(research|find|compare|market|trend|news|competitor|options?|ideas?|learn|why|what)\b/, t) || !roles.length) roles.push("researcher");
  roles.push("writer"); // every run ends in something the owner can read and keep
  if (has(/\b(every|daily|weekly|monthly|recurring|automate|schedule|remind|monitor|watch)\b/, t)) roles.push("ops");
  const steps = roles.map((r) => ({ agent: COMPANY[r as Exclude<Role, "ceo">].agent, request: ASK[r as Exclude<Role, "ceo">](goal), calls: COMPANY[r].calls }));
  if (steps.reduce((n, s) => n + s.calls, 0) > CHAIN_MAX_CALLS) return "This plan would use more than a night shift's budget";
  return { goal: COMPANY_PREFIX + goal, steps, roles: ["ceo", ...roles] };
}

export const roleOf = (agent: string): Role | null => (ROLES.find((r) => COMPANY[r].agent === agent) ?? null);

/** Scorecard (agent-replay) 0-2 mean → letter. null: no judged case for this agent yet (never a pass). */
export function grade(scores: (number | null)[]): string | null {
  const xs = scores.filter((x): x is number => x != null);
  if (!xs.length) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return m >= 1.7 ? "A" : m >= 1.4 ? "B" : m >= 1 ? "C" : m >= 0.6 ? "D" : "F";
}

export type TaskRow = { agent: string; title: string; status: string; result: string | null; created_at: string };
export type OrgSeat = { role: Role; title: string; agent: string; calls: number; grade: string | null; done: number;
  last: { title: string; status: string; at: string; output: string } | null };

/** The org chart: one seat per role, its newest task (rows newest first), finished-task count and scorecard grade.
 *  The CEO's work is the company chains themselves (parent rows "Team: Company: <goal>", agent nova); Nova's other tasks aren't the CEO's. */
export function orgChart(rows: TaskRow[], cases: { agent: string; score: number | null }[]): OrgSeat[] {
  const plan = (r: TaskRow) => r.title.startsWith(CHAIN_TITLE + COMPANY_PREFIX);
  return ROLES.map((role) => {
    const c = COMPANY[role], mine = rows.filter((r) => r.agent === c.agent && (role !== "ceo" || plan(r)));
    const r = mine[0];
    return { role, title: c.title, agent: c.agent, calls: c.calls, grade: grade(cases.filter((x) => x.agent === c.agent).map((x) => x.score)),
      done: mine.filter((x) => x.status === "done").length,
      last: r ? { title: role === "ceo" ? r.title.slice(CHAIN_TITLE.length + COMPANY_PREFIX.length) : r.title, status: r.status, at: r.created_at,
        output: role === "ceo" ? "" : (r.result ?? "").replace(/\s+/g, " ").trim().slice(0, 160) } : null };
  });
}

/** Ledger status for a finished step (runTask's status). */
export const stepStatus = (s: string): "done" | "approval" | "failed" => (s === "done" ? "done" : s === "awaiting_approval" ? "approval" : "failed");

/** The company.step event for a chain step whose approval was just resolved (agents.ts resolvePending): null when the parent isn't a
 *  company chain or the step is still waiting. A rejected approval is "failed", never "done". parentRequest: the chain row's request (ChainMeta JSON). */
export function resolvedStep(parentRequest: string | null, agent: string, status: string, approved = true): { role: Role; status: "done" | "failed" } | null {
  const role = parseMeta(parentRequest)?.company ? roleOf(agent) : null;
  return role && status !== "awaiting_approval" ? { role, status: approved && status === "done" ? "done" : "failed" } : null;
}
