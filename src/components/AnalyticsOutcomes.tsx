"use client";
// Task outcome rows for the AGENTS workforce view (Workforce.tsx). The ANALYTICS planet itself reads /api/analytics/summary.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TaskRow, UsageCostRow } from "@/lib/analytics-outcomes-pure";

type Data = { rows: TaskRow[]; chains: Set<string>; usage: UsageCostRow[] | null; projects: Map<string, string> };
const COLS = "id, parent_id, project_id, agent, title, status, error, pending, created_at, started_at, finished_at";

export function useOutcomeData(days: number) {
  const sb = useMemo(() => createClient(), []);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true; setD(null); setErr("");
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    (async () => {
      // shortcut: newest 2000 tasks / 5000 usage rows in the window; page if a window ever holds more.
      const [t, m, u, p] = await Promise.all([
        sb.from("tasks").select(COLS).gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
        sb.from("missions").select("chain_id").gte("created_at", since),
        sb.from("usage").select("model, purpose, input_tokens, output_tokens, cost_usd").gte("created_at", since).limit(5000),
        sb.from("projects").select("id, name"),
      ]);
      if (t.error) throw t.error;
      if (live) setD({
        rows: (t.data ?? []) as TaskRow[],
        chains: new Set((m.data ?? []).map((x: { chain_id: string | null }) => x.chain_id).filter(Boolean) as string[]),
        usage: u.error ? null : (u.data as UsageCostRow[]),
        projects: new Map((p.data ?? []).map((x: { id: string; name: string }) => [x.id, x.name])),
      });
    })().catch((e) => { if (live) setErr(e.message ?? "Could not load tasks"); });
    return () => { live = false; };
  }, [sb, days]);
  return { d, err };
}
