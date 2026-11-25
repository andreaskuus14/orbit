import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { approveRepair, rejectRepair, repairView } from "@/lib/night-repair";

export const dynamic = "force-dynamic";

// NIGHT REPAIR (DEV → Doctor). GET: config, last nights (self-test results), recent patches with their card text.
// POST {action: "approve" | "reject", id, seen}: the owner's own click on one waiting patch, for the exact version he saw (seen).
// Approve merges (GitHub API or local fast-forward) and requests the existing self-update; nothing else in ORBIT can merge a patch.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function GET_() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await repairView());
}

async function POST_(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/night-repair", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown; seen?: unknown } | null;
  if (!b || typeof b.id !== "string" || typeof b.seen !== "string" || (b.action !== "approve" && b.action !== "reject")) return fail("Body must be {action: approve|reject, id, seen}");
  const r = await (b.action === "approve" ? approveRepair : rejectRepair)(b.id, b.seen);
  return r.ok ? Response.json({ ok: true, message: r.message, view: await repairView() }) : fail(r.error, r.status);
}
export const GET = guard("night-repair", GET_);
export const POST = guard("night-repair", POST_);
