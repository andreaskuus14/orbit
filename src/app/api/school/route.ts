import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { archScene, getSchool, schoolAction } from "@/lib/school";

export const dynamic = "force-dynamic";

// SCHOOL planner (LIFE → School). GET → courses, items, settings and the plan (?arch=<id> → that item's linked ARCH scene).
// POST {action: addCourse|removeCourse|addItem|updateItem|removeItem|settings|linkArch|prep, ...}. Data stays local (school.json).
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const arch = new URL(req.url).searchParams.get("arch");
  if (arch) { const scene = await archScene(arch); return scene ? Response.json({ scene }) : fail("No linked model", 404); }
  return Response.json(await getSchool());
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/school", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || JSON.stringify(b).length > 30_000) return fail("Body must be an object (under 30 kB)");
  const r = await schoolAction(b, user.id);
  return "error" in r ? fail(r.error) : Response.json(r);
}
