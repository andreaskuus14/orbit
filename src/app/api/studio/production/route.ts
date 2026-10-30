import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { checkClipMedia, getJob, listJobs, saveJob, startClipQueue, withJobLock } from "@/lib/clips/factory";
import { isClipId, isJobId } from "@/lib/clips/pure";
import { cleanRights, productionRecords } from "@/lib/clips/production-pure";

// STUDIO production records (production-pure.ts): GET = one record per clip; PATCH { job, rights } = the source's permission basis;
// POST { job, clip } = run the technical media check on the render now. None of these approve or publish anything.
const blocked = (req: Request, m: string) => { const h = req.headers;
  return crossSiteBlocked(m, "/api/studio/production", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") }); };

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const [jobs, stories] = await Promise.all([listJobs(), import("@/lib/clips/story").then((m) => m.listStories(), () => [])]);
  return Response.json({ records: productionRecords(jobs, stories), jobs }); // jobs: for the pipeline board and the calendar
}

export async function PATCH(req: Request) {
  if (blocked(req, "PATCH")) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const b = (await req.json().catch(() => null)) as { job?: unknown; rights?: unknown } | null;
  if (!b || !isJobId(b.job)) return Response.json({ error: "job id required" }, { status: 400 });
  const rights = cleanRights(b.rights);
  if (typeof rights === "string") return Response.json({ error: rights }, { status: 400 });
  return withJobLock(async () => {
    const job = await getJob(b.job as string);
    if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
    job.rights = rights; job.updatedAt = rights.at;
    await saveJob(job);
    return Response.json({ rights });
  });
}

export async function POST(req: Request) {
  if (blocked(req, "POST")) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const b = (await req.json().catch(() => null)) as { job?: unknown; clip?: unknown } | null;
  if (!b || !isJobId(b.job) || !isClipId(b.clip)) return Response.json({ error: "job and clip ids required" }, { status: 400 });
  return withJobLock(async () => {
    const job = await getJob(b.job as string), clip = job?.clips.find((c) => c.id === b.clip);
    if (!job || !clip) return Response.json({ error: "Clip not found" }, { status: 404 });
    const qc = await checkClipMedia(clip, job);
    await saveJob(job);
    return Response.json({ qc });
  });
}
