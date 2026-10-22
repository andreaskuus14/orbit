export type UsageDays = 7 | 30;
export type UsageRow = { model: string; purpose: string; input_tokens: number; output_tokens: number };
export type UsageTotal = { model: string; purpose: string; calls: number | string; input_tokens: number | string; output_tokens: number | string };

/** Older databases can still compute the same grouped totals from the selected window. */
export function aggregateUsage(rows: UsageRow[]): UsageTotal[] {
  return mergeUsageTotals(rows.map((row) => ({ ...row, calls: 1 })));
}

/** Combine RPC groups or page aggregates; model and purpose together identify a group. */
export function mergeUsageTotals(rows: UsageTotal[]): UsageTotal[] {
  const groups = new Map<string, UsageTotal>();
  for (const row of rows) {
    const key = JSON.stringify([row.model, row.purpose]);
    const group = groups.get(key) ?? { model: row.model, purpose: row.purpose, calls: 0, input_tokens: 0, output_tokens: 0 };
    group.calls = Number(group.calls) + Number(row.calls);
    group.input_tokens = Number(group.input_tokens) + Number(row.input_tokens);
    group.output_tokens = Number(group.output_tokens) + Number(row.output_tokens);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Postgres bigint totals may arrive as decimal strings. */
export function usageSummary(groups: UsageTotal[]): { calls: number; tokens: number } {
  return groups.reduce((s, g) => ({ calls: s.calls + Number(g.calls), tokens: s.tokens + Number(g.input_tokens) + Number(g.output_tokens) }), { calls: 0, tokens: 0 });
}

export const missingUsageRpc = (error: { code?: string }) => error.code === "42883" || error.code === "PGRST202";
