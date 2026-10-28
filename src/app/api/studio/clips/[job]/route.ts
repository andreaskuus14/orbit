import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { deleteJob, getJob, startClipQueue } from "@/lib/clips/factory";
import { isJobId } from "@/lib/clips/pure";

// Deletes a job's state and rendered clips (cancelling it if running). The inbox source is never touched.
export async function DELETE(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const h = req.headers; // the middleware matcher skips paths ending in .png etc., so check here too
  if (crossSiteBlocked("DELETE", "/api/studio/clips", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const { job } = await params;
  if (!isJobId(job)) return Response.json({ error: "Invalid job id" }, { status: 400 });
  if (!(await getJob(job))) return Response.json({ error: "Job not found" }, { status: 404 });
  await deleteJob(job);
  return Response.json({ ok: true });
}
