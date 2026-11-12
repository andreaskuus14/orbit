// CORE's world model (roadmap 3, wave 2): Andreas's goals, this week's numbers and upcoming commitments, gathered from
// stored data (goals, STUDIO, BUSINESS, LIFE focus minutes) and rendered by world-pure.ts into one compact block for every CORE turn.
// No new storage: it is rebuilt each time (cached 2 min). Never throws; a failing source just leaves its part out.
import type { SupabaseClient } from "@supabase/supabase-js";
import { render, worldCommitments, type World, type WorldGoal } from "./world-pure";
import { forecast } from "./forecast-pure";

const TTL = 120_000;
const G = globalThis as unknown as { __orbitWorld?: Map<string, { at: number; text: string; private: string[] }> };

export async function worldContext(sb: SupabaseClient, userId: string, now = Date.now()): Promise<string> {
  return (await worldWithPrivate(sb, userId, now)).text;
}
/** The block plus its commitment texts, which core.ts adds to privateText so no web/agent call carries them out. */
export async function worldWithPrivate(sb: SupabaseClient, userId: string, now = Date.now()): Promise<{ text: string; private: string[] }> {
  const cache = (G.__orbitWorld ??= new Map()), hit = cache.get(userId);
  if (hit && now - hit.at < TTL) return hit;
  try {
    const [goals, week, life, commits] = await Promise.all([
      import("./goals").then((m) => m.listGoals(sb, userId)).catch(() => []),
      import("./weekly").then((m) => m.gatherWeek(sb, now)).catch(() => null),
      import("./life").then((m) => m.exportLife()).catch(() => null),
      import("./dayplan").then((m) => m.commitments()).catch(() => []),
    ]);
    const wg: WorldGoal[] = goals.map((r) => {
      const d = r.doc, last = d.metric.samples.at(-1);
      const live = d.status !== "done" && d.status !== "stopped" && d.metric.target !== undefined && (d.metric.kind === "manual" || d.metric.kind === "youtube_subscribers");
      return {
        ...(live ? { forecast: forecast(d.metric.samples, d.metric.target, d.deadline, now).summary } : {}),
        id: r.id, title: d.title, why: d.why, ...(d.deadline ? { deadline: d.deadline } : {}),
        ...(d.metric.target !== undefined ? { metric: { name: d.metric.how || d.metric.kind, target: d.metric.target, current: last?.value ?? 0 } } : {}),
        status: d.status === "done" || d.status === "stopped" ? "done" : d.status === "paused" ? "paused" : "active",
      };
    });
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    const focusMin = life ? Object.entries(life.focus ?? {}).filter(([d]) => d >= day(now - 7 * 86_400_000)).reduce((a, [, m]) => a + (Number(m) || 0), 0) : 0;
    const world: World = {
      goals: wg,
      weekly: {
        shortsPublished: week?.shorts.length ?? 0, shortsViews: (week?.shorts ?? []).reduce((a, s) => a + (s.views ?? 0), 0),
        leadsContacted: week?.business.contacted ?? 0, studyHours: Math.round((focusMin / 60) * 10) / 10,
      },
      constraints: [],
      // No LIFE text here: this block is in context before any taint check. worldCommitments keeps only allowlisted source kinds.
      commitments: worldCommitments(commits),
    };
    const entry = { at: now, text: render(world, day(now)), private: world.commitments.map((c) => c.text) };
    cache.set(userId, entry);
    return entry;
  } catch (e) {
    console.error("[orbit] world model failed", e);
    return { text: "", private: [] };
  }
}
