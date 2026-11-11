import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { complaintsFor, mineComplaints, writeAngle } from "@/lib/complaints";
import { isNicheId } from "@/lib/niche-pure";

export const dynamic = "force-dynamic";

// BUSINESS "What users hate" (complaints.ts): public reviews only, read-only, local file.
// GET ?id= → the stored report | POST {action:"mine"|"angle", id} (both on the owner's click).
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const id = new URL(req.url).searchParams.get("id");
  if (!isNicheId(id)) return fail("id required");
  return Response.json({ report: await complaintsFor(id) });
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business/complaints", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b) || !isNicheId(b.id)) return fail("id required");
  if (b.action !== "mine" && b.action !== "angle") return fail("action must be mine or angle");
  try {
    if (b.action === "mine") return Response.json({ report: await mineComplaints(b.id, req.signal) });
    await writeAngle(b.id, req.signal);
    return Response.json({ report: await complaintsFor(b.id) });
  } catch (e) { return fail(e instanceof Error ? e.message : "Failed", 502); }
}
