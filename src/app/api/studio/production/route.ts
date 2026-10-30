import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { checkClipMedia, getJob, listJobs, readState, saveJob, startClipQueue, studioRoot, withJobLock } from "@/lib/clips/factory";
import { emptyLearn, learnProblem, type LearnState } from "@/lib/clips/learn-pure";
import { capacity, liveIds, outcomeOf, type Outcome } from "@/lib/clips/depth-pure";
import { readPublishSettings } from "@/lib/clips/publish-schedule";
import { baseEdit, isClipId, isJobId } from "@/lib/clips/pure";
import { cleanRights, productionRecords, recordId } from "@/lib/clips/production-pure";

// STUDIO production records (production-pure.ts): GET = one record per clip; PATCH { job, rights } = the source's permission basis;
// POST { job, clip } = run the technical media check on the render now. None of these approve or publish anything.
const blocked = (req: Request, m: string) => { const h = req.headers;
  return crossSiteBlocked(m, "/api/studio/production", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") }); };

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const [jobs, stories, learn, settings] = await Promise.all([listJobs(), import("@/lib/clips/story").then((m) => m.listStories(), () => []),
    readState<LearnState>(studioRoot(), "learn", learnProblem).catch(() => null), readPublishSettings()]);
  const recs = Object.values((learn ?? emptyLearn()).clips), outcomes: Record<string, Outcome> = {};
  for (const j of jobs) for (const c of j.clips) { const o = outcomeOf(c, recs); if (o) outcomes[recordId(j.id, c.id)] = o; }
  const records = productionRecords(jobs, stories), live = liveIds(recs);
  // jobs: pipeline board + calendar; live: video ids seen public (confirms a scheduled Short); bases: each job's first-pass edit (STU05)
  return Response.json({ records, jobs, live: [...live], outcomes, capacity: capacity(records, jobs, settings, Date.now(), live),
    bases: Object.fromEntries(jobs.map((j) => [j.id, baseEdit(j.options)])) });
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
