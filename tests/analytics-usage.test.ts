import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateUsage, mergeUsageTotals, usageSummary, missingUsageRpc, type UsageRow, type UsageTotal } from "../src/lib/analytics-usage-pure.ts";
import { loadUsageTotals } from "../src/lib/analytics-usage.ts";

test("totals group by both model and purpose and count zero-token calls", () => {
  const rows = [
    { model: "sonnet", purpose: "core", input_tokens: 10, output_tokens: 4 },
    { model: "sonnet", purpose: "core", input_tokens: 0, output_tokens: 0 },
    { model: "haiku", purpose: "core", input_tokens: 5, output_tokens: 2 },
    { model: "sonnet", purpose: "pulse", input_tokens: 20, output_tokens: 3 },
  ];
  const totals = aggregateUsage(rows);
  assert.equal(totals.length, 3);
  assert.deepEqual(totals[0], { model: "sonnet", purpose: "core", calls: 2, input_tokens: 10, output_tokens: 4 });
  assert.deepEqual(usageSummary(totals), { calls: 4, tokens: 44 });
  assert.deepEqual(usageSummary([]), { calls: 0, tokens: 0 });
  assert.deepEqual(aggregateUsage([]), []);
});

test("page merging handles bigint strings and does not mutate input", () => {
  const group = { model: "m", purpose: "p", calls: "2", input_tokens: "2147483648", output_tokens: "1" };
  assert.deepEqual(usageSummary(mergeUsageTotals([group, group])), { calls: 4, tokens: 4294967298 });
  assert.equal(group.calls, "2");
  assert.equal(mergeUsageTotals([{ ...group, model: "a/b", purpose: "c" }, { ...group, model: "a", purpose: "b/c" }]).length, 2);
});

test("only the two missing-function codes permit the legacy fallback", () => {
  for (const code of ["42883", "PGRST202"]) assert.ok(missingUsageRpc({ code }));
  for (const code of ["42501", "PGRST301", "57014", undefined]) assert.ok(!missingUsageRpc({ code }));
});

const NOW = Date.parse("2026-10-22T12:00:00Z");
function store(error: { code: string } | null, rows: UsageRow[] = [], totals: UsageTotal[] = [], pageError = false) {
  const rpcCalls: unknown[] = [], queries: { since?: string; until?: string; order?: string; range?: number[] }[] = [];
  const client = {
    rpc(name: string, args: unknown) { rpcCalls.push([name, args]); return Promise.resolve({ data: totals, error }); },
    from(table: string) {
      assert.equal(table, "usage");
      const q: typeof queries[number] = {}; queries.push(q);
      const builder = {
        select(columns: string) { assert.equal(columns, "model, purpose, input_tokens, output_tokens"); return builder; },
        gte(_k: string, v: string) { q.since = v; return builder; },
        lte(_k: string, v: string) { q.until = v; return builder; },
        order(k: string) { q.order = k; return builder; },
        range(a: number, b: number) { q.range = [a, b]; return Promise.resolve({ data: rows.slice(a, b + 1), error: pageError ? { code: "42501" } : null }); },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls, queries };
}

test("installed RPC transfers grouped results without fetching individual usage rows", async () => {
  const totals = [{ model: "sonnet", purpose: "core", calls: 10, input_tokens: 90, output_tokens: 10 }];
  const s = store(null, [], totals);
  assert.deepEqual(await loadUsageTotals(s.client, 30, NOW), totals);
  assert.deepEqual(s.rpcCalls, [["usage_totals", { p_days: 30 }]]);
  assert.equal(s.queries.length, 0);
});

test("both missing-RPC codes page the selected window and merge groups across the 1000-row boundary", async () => {
  const rows = Array.from({ length: 1001 }, () => ({ model: "sonnet", purpose: "core", input_tokens: 2, output_tokens: 1 }));
  for (const [code, days] of [["42883", 7], ["PGRST202", 30]] as const) {
    const s = store({ code }, rows);
    assert.deepEqual(usageSummary(await loadUsageTotals(s.client, days, NOW)), { calls: 1001, tokens: 3003 });
    assert.deepEqual(s.queries.map((q) => q.range), [[0, 999], [1000, 1999]]);
    for (const q of s.queries) {
      assert.equal(q.since, new Date(NOW - days * 86400000).toISOString());
      assert.equal(q.until, new Date(NOW).toISOString());
      assert.equal(q.order, "id");
    }
  }
});

test("permissions and fallback-page errors propagate instead of showing misleading zero totals", async () => {
  const s = store({ code: "42501" });
  await assert.rejects(loadUsageTotals(s.client, 7, NOW), { code: "42501" });
  assert.equal(s.queries.length, 0);
  await assert.rejects(loadUsageTotals(store({ code: "PGRST202" }, [], [], true).client, 7, NOW), { code: "42501" });
});
