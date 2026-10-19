import { requireUser } from "@/lib/supabase/server";
import { learnView } from "@/lib/clips/learn";
import { studyShort, studyView } from "@/lib/clips/study";
import { modelStatus } from "@/lib/clips/score";
import { createMemory } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// "What ORBIT learned": GET = the analysis (refreshes published clips' stats first when 6 h have passed) + the viral-study playbook
// + the virality score model's status (score.ts).
// POST {id,title,channel,views?,source} = study one Short (takes 1-3 min; answers when done). Logic: src/lib/clips/learn.ts, study.ts.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try {
    const [l, study] = await Promise.all([learnView(), studyView().catch(() => null)]);
    const model = await modelStatus().catch(() => null); // after learnView: reads the freshly collected stats
    return Response.json({ ...l, study, model });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Couldn't load what ORBIT learned" }, { status: 500 }); }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(req: Request) {
  const { res, sb, user } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.id !== "string" || !/^[\w-]{11}$/.test(b.id)) return Response.json({ error: "A YouTube video id is required" }, { status: 400 });
  const views = typeof b.views === "number" && Number.isFinite(b.views) ? b.views : undefined;
  try {
    const lesson = await studyShort({ id: b.id, title: str(b.title, 200), channel: str(b.channel, 100), views, source: b.source === "own" ? "own" : "niche" });
    // A short note in ORBIT's memories too; the study itself is already saved, so a failure here is only logged.
    await createMemory(sb, user.id, { kind: "research", title: `Viral study: ${lesson.title || lesson.id}`.slice(0, 300), source: "clip-study",
      url: `https://www.youtube.com/shorts/${lesson.id}`, tags: ["viral-study", "shorts"],
      content: [lesson.why, `Hook: ${lesson.hook.technique}${lesson.hook.text ? ` ("${lesson.hook.text}")` : ""} · ${lesson.facts.durationSec} s · ${lesson.facts.cuts} cuts (avg shot ${lesson.facts.avgShotSec} s) · payoff at ${lesson.payoffSec} s`,
        lesson.effects.length ? `Effects: ${lesson.effects.join(", ")}` : "", lesson.titlePattern ? `Title pattern: ${lesson.titlePattern}` : "", ...lesson.lessons.map((l) => `- ${l}`)].filter(Boolean).join("\n") })
      .catch((e) => console.error("[orbit] viral study memory not saved:", e instanceof Error ? e.message : e));
    return Response.json({ lesson });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Study failed";
    return Response.json({ error: msg }, { status: /Already studying/.test(msg) ? 409 : /paused|usage/i.test(msg) ? 429 : 502 });
  }
}
