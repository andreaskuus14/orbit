import { stat } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { checkTools, createJob, ensureDirs, inboxDir, listDownloads, listInbox, listJobs, startClipQueue, studioRoot } from "@/lib/clips/factory";
import { isInboxName, validOptions } from "@/lib/clips/pure";

export const dynamic = "force-dynamic";

// CLIP FACTORY: inbox videos → vertical Shorts. Contract: src/lib/clips/types.ts.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  await ensureDirs();
  const [jobs, downloads] = await Promise.all([listJobs(), listDownloads()]);
  // Newest 30, plus any older job still running or holding clips to review/publish, so those never drop off the list.
  const shown = jobs.filter((j, i) => i < 30 || !["done", "failed"].includes(j.status) || j.clips.some((c) => c.status === "ready" || c.status === "approved"));
  return Response.json({ root: studioRoot(), tools: await checkTools(), inbox: await listInbox(jobs, downloads), jobs: shown, downloads: downloads.slice(0, 20) });
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const { source, force = false } = b;
  if (!isInboxName(source)) return Response.json({ error: "source must be a video file name from the inbox" }, { status: 400 });
  const options = validOptions(b);
  if (typeof options === "string") return Response.json({ error: options }, { status: 400 });
  if (typeof force !== "boolean") return Response.json({ error: "force must be a boolean" }, { status: 400 });
  if ((await listDownloads()).some((d) => d.parts?.includes(source))) return Response.json({ error: "That video is still downloading" }, { status: 409 });
  const s = await stat(path.join(inboxDir(), source)).catch(() => null);
  if (!s?.isFile()) return Response.json({ error: "File not found in the inbox" }, { status: 404 });
  const tools = await checkTools();
  if (!tools.ffmpeg) return Response.json({ error: "ffmpeg is missing", tools }, { status: 503 });
  const existing = (await listJobs()).find((j) => j.source === source && j.status !== "failed");
  if (existing && !force) return Response.json({ error: "This video already has a job", job: existing }, { status: 409 });
  const job = await createJob(source, options);
  return Response.json({ job });
}
