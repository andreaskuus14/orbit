import { requireUser } from "@/lib/supabase/server";
import { approveStory, editStory, getStory, listStories, quoteStory, runningStory, writeStory } from "@/lib/clips/story";
import { validStoryOpts } from "@/lib/clips/story-pure";

export const dynamic = "force-dynamic";

// AI Story (Clip Factory). Generation only ever starts from action "approve" with the quoted credits (ORBIT rule 6).
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ stories: (await listStories()).slice(0, 20), running: runningStory(), dryRun: process.env.ORBIT_HIGGSFIELD_DRY_RUN === "1" });
}

/** Body: {action:"write", idea, style, length, voice, motion} | {action:"edit", id, story} | {action:"quote", id} | {action:"approve", id, credits}. */
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
    const out = b.action === "edit" ? await editStory(job, b.story)
      : b.action === "quote" ? await quoteStory(job, req.signal)
      : b.action === "approve" ? await approveStory(job, b.credits)
      : "action must be write, edit, quote or approve";
    return typeof out === "string" ? Response.json({ error: out }, { status: 409 }) : Response.json({ story: out });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
