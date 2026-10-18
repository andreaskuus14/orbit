import type { SupabaseClient } from "@supabase/supabase-js";
import { kickQueue } from "./agents";
import { automationDue, type Schedule } from "./pure";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";

// Automation engine. Each automation run becomes an ordinary agent task (traceable, retryable, approvals intact).
// Called every minute by the server-side scheduler with the secret-key client, so every query filters by user_id.

type Automation = {
  id: string; user_id: string; name: string; trigger: "schedule" | "event"; schedule: Schedule | null;
  event: string | null; kind_filter: string | null; agent: string; prompt: string;
  last_run_at: string | null; run_count: number; created_at: string;
};
const COLS = "id, user_id, name, trigger, schedule, event, kind_filter, agent, prompt, last_run_at, run_count, created_at";
// Only memories the user saved trigger "memory.created" automations: agent/briefing saves would cause loops.
const USER_SOURCES = ["capture", "upload", "url", "core"];

/** Queue one run of an automation as an agent task and start it. */
export async function startAutomation(sb: SupabaseClient, a: Automation, trigger: string) {
  if (stopAllOn()) throw new Error(PAUSED_MSG);
  const request = `${a.prompt}\n\n(Automation "${a.name}", triggered: ${trigger}.)`;
  const { data, error } = await sb.from("tasks").insert({
    user_id: a.user_id, agent: a.agent, title: `⚙ ${a.name}`.slice(0, 200), request, automation_id: a.id,
  }).select("id").single();
  if (error) throw error;
  await sb.from("automations").update({ last_run_at: new Date().toISOString(), run_count: a.run_count + 1 }).eq("id", a.id).eq("user_id", a.user_id);
  void kickQueue(sb, a.user_id);
  return data.id as string;
}

/** Start every scheduled automation whose time has come. */
export async function runDueAutomations(sb: SupabaseClient, userId: string, now = new Date()) {
  const { data, error } = await sb.from("automations").select(COLS).eq("user_id", userId).eq("enabled", true).eq("trigger", "schedule");
  if (error) throw error;
  for (const a of (data ?? []) as Automation[]) {
    if (a.schedule && automationDue(a.schedule, a.last_run_at, a.created_at, now)) {
      console.log(`[orbit] automation "${a.name}" starting (scheduled)`);
      await startAutomation(sb, a, "schedule").catch((e) => console.error(`[orbit] automation "${a.name}" failed to start:`, e?.message ?? e));
    }
  }
}

const g = globalThis as unknown as { __orbitEventCursor?: number };

/** React to new events (all users): memory saved → memory.created automations; briefing done → briefing.ready. */
export async function handleEvents(sb: SupabaseClient) {
  if (g.__orbitEventCursor === undefined) {
    // Start from "now" so a restart never replays old events.
    const { data, error } = await sb.from("events").select("id").order("id", { ascending: false }).limit(1);
    if (error) throw error; // a failed read must not start the cursor at 0 and replay every past event
    g.__orbitEventCursor = data?.[0]?.id ?? 0;
    return;
  }
  const { data: events, error } = await sb.from("events").select("id, user_id, type, payload")
    .gt("id", g.__orbitEventCursor).in("type", ["memory.created", "pulse.completed"]).order("id").limit(200);
  if (error) throw error;
  for (const e of events ?? []) {
    g.__orbitEventCursor = e.id;
    const p = (e.payload ?? {}) as { title?: string; kind?: string; source?: string };
    const event = e.type === "pulse.completed" ? "briefing.ready" : "memory.created";
    if (event === "memory.created" && !USER_SOURCES.includes(p.source ?? "")) continue;
    const { data: autos } = await sb.from("automations").select(COLS).eq("user_id", e.user_id).eq("enabled", true).eq("trigger", "event").eq("event", event);
    for (const a of (autos ?? []) as Automation[]) {
      if (a.kind_filter && a.kind_filter !== p.kind) continue;
      const what = event === "briefing.ready" ? "a new news briefing was saved to memory (find it with search_memory, newest first)"
        : `the user just saved a ${p.kind ?? "memory"} titled "${p.title ?? ""}" (read it with search_memory using that title)`;
      console.log(`[orbit] automation "${a.name}" starting (${event})`);
      await startAutomation(sb, a, what).catch((err) => console.error(`[orbit] automation "${a.name}" failed to start:`, err?.message ?? err));
    }
  }
}
