import { guard } from "@/lib/api-route";
import { stat } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { checkTools, createJob, ensureDirs, inboxDir, listDownloads, listInbox, listJobs, listQuarantined, publishingKey, startClipQueue, studioRoot } from "@/lib/clips/factory";
import { isInboxName, validOptions } from "@/lib/clips/pure";
import { readFailAck } from "@/lib/clips/fail-ack";
import { etagFor, etagMatches } from "@/lib/clips/job-cache-pure";
import { shownJobs } from "@/lib/clips/pure";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

// CLIP FACTORY: inbox videos → vertical Shorts. Contract: src/lib/clips/types.ts.
async function GET_(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  await ensureDirs();
  const [jobs, downloads] = await Promise.all([listJobs({ shared: true }), listDownloads()]); // read-only here: the cached jobs, no copies
  const body = JSON.stringify({ root: studioRoot(), tools: await checkTools(), inbox: await listInbox(jobs, downloads), jobs: shownJobs(jobs), downloads: downloads.slice(0, 20),
    quarantined: await listQuarantined(), publishing: publishingKey(), failAck: await readFailAck().catch(() => []) }); // publishing: "<job>/<clip>" uploading now (other "uploading" clips are stale) // read after the lists: reading is what moves damaged files aside
  // ETag/304 (job-cache-pure.ts): a poll whose list hasn't changed gets no body; the client keeps what it has. ORBIT_CLIPS_ETAG=0 = always 200.
  if (process.env.ORBIT_CLIPS_ETAG === "0") return new Response(body, { headers: { "Content-Type": "application/json" } });
  const tag = etagFor(createHash("sha1").update(body).digest("hex"));
  const headers = { ETag: tag, "Cache-Control": "private, no-cache" };
  if (etagMatches(req.headers.get("if-none-match"), tag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
}

async function POST_(req: Request) {
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
export const GET = guard("studio/clips", GET_);
export const POST = guard("studio/clips", POST_);
