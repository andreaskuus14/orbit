// /api/agents task + usage counts (efficiency pass 2). Before: every task row (agent, status, title) and every agent.* usage row
// of 30 days came over the wire every 5 s while OPERATIONS was open. Now grouped counts come from agent_task_counts()
// (migration 0028) and usage_totals(30) (0014). Pure; tested in tests/efficiency2.test.ts. ORBIT_AGENT_COUNTS=0 = the old scan.

export type TaskCount = { agent: string; status: string; n: number | string };
export type AgentStat = { running: number; done: number; failed: number; calls: number; tokens: number };

/** The old per-row scan folded into the same groups the SQL returns (fallback before migration 0028, and the reference in tests). */
export function countTasks(rows: { agent: string; status: string; title: unknown }[], chainTitle: string): TaskCount[] {
  const m = new Map<string, TaskCount>();
  for (const r of rows) {
    if (String(r.title).startsWith(chainTitle)) continue; // a team's parent row isn't Nova working
    const k = `${r.agent}\0${r.status}`, c = m.get(k);
    if (c) c.n = Number(c.n) + 1; else m.set(k, { agent: r.agent, status: r.status, n: 1 });
  }
  return [...m.values()];
}

/** One agent's stats, exactly as the route computed them from rows. */
export function agentStat(slug: string, counts: TaskCount[], usage: { purpose: string; calls: number | string; input_tokens: number | string; output_tokens: number | string }[]): AgentStat {
  const n = (...st: string[]) => counts.filter((c) => c.agent === slug && st.includes(c.status)).reduce((a, c) => a + Number(c.n), 0);
  const u = usage.filter((x) => x.purpose === `agent.${slug}`);
  return { running: n("running"), done: n("done", "awaiting_approval"), failed: n("failed"),
    calls: u.reduce((a, x) => a + Number(x.calls), 0), tokens: u.reduce((a, x) => a + Number(x.input_tokens) + Number(x.output_tokens), 0) };
}
