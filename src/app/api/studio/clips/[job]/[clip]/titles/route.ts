import { requireUser } from "@/lib/supabase/server";
import { askClaude } from "@/lib/claude";
import { getJob, isJobBusy, loadAnalysis, saveJob, startClipQueue, withJobLock } from "@/lib/clips/factory";
import { tastePrompt } from "@/lib/clips/learn";
import { isClipId, isJobId } from "@/lib/clips/pure";
import { TITLES_SYSTEM, creatorFromSource, parseTitleOptions } from "@/lib/clips/titles";
import { devlogMoment } from "@/lib/clips/devlog";

// "✨ More titles": one background Claude call → 3 scored title options on clip.titleOptions (replacing older ones).
// Picking one is a normal PATCH { title }. Works for clips made before options existed.
export async function POST(req: Request, { params }: { params: Promise<{ job: string; clip: string }> }) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const { job: jobId, clip: clipId } = await params;
  if (!isJobId(jobId) || !isClipId(clipId)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const job = await getJob(jobId);
  const clip = job?.clips.find((c) => c.id === clipId);
  if (!job || !clip) return Response.json({ error: "Clip not found" }, { status: 404 });
  if (isJobBusy(job)) return Response.json({ error: "Wait for the job to finish" }, { status: 409 });
  const a = await loadAnalysis(jobId); // no analysis (old job): title + hook + reason still give Claude enough to work with
  const clean = (s: string) => s.replace(/[<>]/g, "");
  const text = clean(a?.words.filter((w) => w.start >= clip.start && w.end <= clip.end).map((w) => w.text).join(" ") ?? "").slice(0, 3000);
  const creator = creatorFromSource(job.source);
  const prompt = `Current title: ${clean(clip.title)}\nHook: ${clean(clip.hook)}\nWhy it works: ${clean(clip.reason)}${creator ? `\nCreator (from the file name): ${creator}` : ""}\n<transcript>\n${text || "(no transcript)"}\n</transcript>`;
  let options;
  try {
    const r = await askClaude(prompt, TITLES_SYSTEM + (await tastePrompt()), { lane: "background", signal: req.signal });
    options = parseTitleOptions(r.text);
    if (job.devlogDay) options = devlogMoment({ title: "", titleOptions: options }, job.devlogDay).titleOptions ?? []; // keep "Day N" (and dedupe)
  } catch (e) {
    return Response.json({ error: `Claude: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
  if (!options.length) return Response.json({ error: "Claude's reply had no usable titles — try again" }, { status: 502 });
  return withJobLock(async () => {
    const job = await getJob(jobId); // re-read: the clip may have changed during the call
    const clip = job?.clips.find((c) => c.id === clipId);
    if (!job || !clip) return Response.json({ error: "Clip not found" }, { status: 404 });
    if (isJobBusy(job)) return Response.json({ error: "Wait for the job to finish" }, { status: 409 });
    clip.titleOptions = options;
    job.updatedAt = new Date().toISOString();
    await saveJob(job);
    return Response.json({ clip });
  });
}
