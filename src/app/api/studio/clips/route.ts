import { stat } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { checkTools, createJob, ensureDirs, inboxDir, listInbox, listJobs, startClipQueue, studioRoot } from "@/lib/clips/factory";
import { isInboxName } from "@/lib/clips/pure";

export const dynamic = "force-dynamic";

// CLIP FACTORY: inbox videos → vertical Shorts. Contract: src/lib/clips/types.ts.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  await ensureDirs();
  const jobs = await listJobs();
  return Response.json({ root: studioRoot(), tools: await checkTools(), inbox: await listInbox(jobs), jobs: jobs.slice(0, 30) });
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const { source, count = 5, maxSec = 45, captions = true, force = false } = b;
  if (!isInboxName(source)) return Response.json({ error: "source must be a video file name from the inbox" }, { status: 400 });
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 10) return Response.json({ error: "count must be 1-10" }, { status: 400 });
  if (!Number.isInteger(maxSec) || (maxSec as number) < 15 || (maxSec as number) > 120) return Response.json({ error: "maxSec must be 15-120" }, { status: 400 });
  if (typeof captions !== "boolean" || typeof force !== "boolean") return Response.json({ error: "captions/force must be booleans" }, { status: 400 });
  const s = await stat(path.join(inboxDir(), source)).catch(() => null);
  if (!s?.isFile()) return Response.json({ error: "File not found in the inbox" }, { status: 404 });
  const tools = await checkTools();
  if (!tools.ffmpeg) return Response.json({ error: "ffmpeg is missing", tools }, { status: 503 });
  const existing = (await listJobs()).find((j) => j.source === source && j.status !== "failed");
  if (existing && !force) return Response.json({ error: "This video already has a job", job: existing }, { status: 409 });
  const job = await createJob(source, { count: count as number, maxSec: maxSec as number, captions });
  return Response.json({ job });
}
