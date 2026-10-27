// "Future-self call", IO half: gathers the last 12 weeks of counts (stored data only, a failing source counts as nothing) and
// turns them into the call's opener (one FAST_MODEL phrasing, checked by cleanFuture, else the deterministic script) and the
// persona for the call's later turns. Reads Shorts, Roblox sessions, prospects, ARCH memories, goals and kept lessons; never
// journals or LIFE data. Pure parts and the rules: future-pure.ts. Wired into call.ts as the "future" call reason.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, FAST_MODEL, recordUsage } from "./claude";
import { listJobs } from "./clips/factory";
import { listDevSessions } from "./dev-session";
import { keptLessons } from "./lessons";
import { isOpen } from "./goals-pure";
import { FUTURE_SYSTEM, WEEKS, cleanFuture, futurePrompt, futureScript, futureWho, hasData, project, type FutureIn, type Projection } from "./future-pure";

const LIFE = /^(life|journal)$/i;

export async function gatherFuture(sb: SupabaseClient, userId: string, now = Date.now()): Promise<FutureIn> {
  const since = new Date(now - WEEKS * 7 * 86_400_000).toISOString();
  const rows = <T,>(p: PromiseLike<{ data: T[] | null }>) => Promise.resolve(p).then((r) => r.data ?? [], () => [] as T[]);
  const [jobs, sessions, prospects, arch, goals, lessons] = await Promise.all([
    listJobs().catch(() => []),
    listDevSessions(sb, userId).catch(() => []), // shortcut: the session log keeps the newest 60; enough for 12 weeks of hobby sessions
    // shortcut: updated_at stands in for "contacted on" (no contacted_at column); fine while prospects move one stage at a time
    rows<{ updated_at: string }>(sb.from("prospects").select("updated_at").in("stage", ["contacted", "replied", "pilot", "paying"]).gte("updated_at", since).limit(1000)),
    rows<{ created_at: string }>(sb.from("memories").select("created_at").eq("user_id", userId).contains("tags", ["arch"]).gte("created_at", since).limit(2000)),
    rows<{ status: string; doc: { title?: string; metric?: { target?: number; samples?: { at: string; value: number }[] } } }>(sb.from("goals").select("status, doc").limit(30)),
    keptLessons(userId).catch(() => []),
  ]);
  return {
    now,
    events: {
      shorts: jobs.flatMap((j) => j.clips).flatMap((c) => (c.publish?.status === "done" && c.publish.at ? [c.publish.at] : [])),
      roblox: sessions.map((s) => s.start),
      business: prospects.map((p) => p.updated_at),
      arch: arch.map((m) => m.created_at),
    },
    goals: goals.filter((g) => isOpen(g.status) && g.doc?.metric?.samples?.length).map((g) => ({ title: String(g.doc.title ?? "a goal"), target: g.doc.metric!.target, samples: g.doc.metric!.samples! })),
    lessons: lessons.filter((l) => !LIFE.test(l.planet) && !LIFE.test(l.area)).sort((a, b) => b.confidence - a.confidence).map((l) => l.text),
  };
}

export const futureProjection = async (sb: SupabaseClient, userId: string, now = Date.now()) => project(await gatherFuture(sb, userId, now));
export const futureReady = (sb: SupabaseClient, userId: string) => futureProjection(sb, userId).then(hasData, () => false);

/** The call's first words and the persona for its later turns. Never throws: any failure keeps the deterministic script. */
export async function futureCall(sb: SupabaseClient, userId: string, timeoutMs = 20_000, p?: Projection): Promise<{ text: string; who: string }> {
  p ??= await futureProjection(sb, userId);
  const draft = futureScript(p);
  if (!hasData(p)) return { text: draft, who: futureWho(p) };
  try {
    const r = await askClaude(futurePrompt(p, draft), FUTURE_SYSTEM, { lane: "foreground", model: FAST_MODEL, timeoutMs, purpose: "call.future" });
    void recordUsage(sb, userId, "call.future", r, FAST_MODEL);
    return { text: cleanFuture(r.text, p, draft), who: futureWho(p) };
  } catch (e) {
    console.error("[call] future:", e instanceof Error ? e.message : e);
    return { text: draft, who: futureWho(p) };
  }
}
