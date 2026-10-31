import { requireUser } from "@/lib/supabase/server";
import { approveStory, editStory, redoStory, getStory, listStories, quoteStory, runningStory, writeStory } from "@/lib/clips/story";
import { validStoryOpts } from "@/lib/clips/story-pure";
import { studioSection } from "@/lib/site-pictures-pure";

export const dynamic = "force-dynamic";

// AI Story (Clip Factory). Generation only ever starts from action "approve" with the quoted credits (ORBIT rule 6).
/** ?section=youtube|websites|other → only that STUDIO section's jobs (site-pictures-pure studioSection). */
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const section = new URL(req.url).searchParams.get("section");
  const all = await listStories(), shown = section ? all.filter((j) => studioSection(j) === section) : all;
  return Response.json({ stories: shown.slice(0, section === "websites" ? 60 : 20), running: runningStory(), dryRun: process.env.ORBIT_HIGGSFIELD_DRY_RUN === "1" });
}

/** Body: {action:"write", idea, style, length, voice, motion, format?, model?} | {action:"edit", id, story, model?} | {action:"quote", id} | {action:"approve", id, credits, seen} | {action:"redo", id, key}. */
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  try {
    if (b.action === "write") {
      const o = validStoryOpts(b);
      if (typeof o === "string") return Response.json({ error: o }, { status: 400 });
      return Response.json({ story: await writeStory(o, req.signal) });
    }
    const job = typeof b.id === "string" ? await getStory(b.id) : null;
    if (!job) return Response.json({ error: "Story not found" }, { status: 404 });
    const out = b.action === "edit" ? await editStory(job, b.story, b.model)
      : b.action === "quote" ? await quoteStory(job, req.signal)
      : b.action === "approve" ? await approveStory(job, b.credits, b.seen)
      : b.action === "redo" ? await redoStory(job, b.key)
      : "action must be write, edit, quote, approve or redo";
    return typeof out === "string" ? Response.json({ error: out }, { status: 409 }) : Response.json({ story: out });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
