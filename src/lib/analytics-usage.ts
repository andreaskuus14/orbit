import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateUsage, mergeUsageTotals, missingUsageRpc, type UsageDays, type UsageRow, type UsageTotal } from "./analytics-usage-pure.ts";

/** Normal path transfers grouped rows only. Before migration 0014, page the same bounded window. */
export async function loadUsageTotals(sb: SupabaseClient, days: UsageDays, now = Date.now()): Promise<UsageTotal[]> {
  const { data, error } = await sb.rpc("usage_totals", { p_days: days });
  if (!error) return (data ?? []) as UsageTotal[];
  if (!missingUsageRpc(error)) throw error;
  const since = new Date(now - days * 86_400_000).toISOString();
  const until = new Date(now).toISOString();
  let groups: UsageTotal[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await sb.from("usage").select("model, purpose, input_tokens, output_tokens")
      .gte("created_at", since).lte("created_at", until).order("id").range(offset, offset + pageSize - 1);
    if (page.error) throw page.error;
    const rows = (page.data ?? []) as UsageRow[];
    groups = mergeUsageTotals([...groups, ...aggregateUsage(rows)]);
    if (rows.length < pageSize) break;
  }
  return groups;
}
