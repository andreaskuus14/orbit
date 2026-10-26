import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { getChronicle, titleMonth } from "@/lib/chronicle";

export const dynamic = "force-dynamic";

// MEMORY → Chronicle. GET ?private=1 adds journal moments (his local toggle; never sent to a model).
// POST {month: "YYYY-MM"} titles that finished month's weekly arcs: one fast-model call per month, ever.
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const priv = new URL(req.url).searchParams.get("private") === "1";
  try { return Response.json(await getChronicle(sb, user.id, priv)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not build the chronicle" }, { status: 500 }); }
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/chronicle", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { month?: unknown } | null;
  const month = typeof b?.month === "string" && /^\d{4}-\d{2}$/.test(b.month) ? b.month : "";
  if (!month) return Response.json({ error: "month must be YYYY-MM" }, { status: 400 });
  return Response.json({ titles: await titleMonth(sb, user.id, month) });
}
