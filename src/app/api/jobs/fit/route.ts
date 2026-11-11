import { requireUser } from "@/lib/supabase/server";
import { jobFit } from "@/lib/job-fit";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** POST {posting} → fit score, matches, gaps and DRAFT CV summary + cover letter. Read-only: nothing is saved or sent. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => ({}));
  const posting = typeof b?.posting === "string" ? b.posting.trim() : "";
  if (posting.length < 80) return Response.json({ error: "Paste the whole job posting (at least a few lines)." }, { status: 400 });
  const r = await jobFit(sb, user.id, posting, req.signal);
  return Response.json(r, { status: "error" in r ? 502 : 200 });
}
