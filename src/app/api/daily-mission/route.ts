import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { CATALOGUE, DEFAULT_PICKS, MAX_PICKS, TARGET_IDS } from "@/lib/daily-mission-pure";
import { loadPicks, savePicks } from "@/lib/daily-mission";

export const dynamic = "force-dynamic";

// Daily mission targets (daily-mission-pure). GET → { targets (his picks, [] = default), defaults, catalogue, max }; POST { targets } → saved picks.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ targets: await loadPicks(), defaults: DEFAULT_PICKS, max: MAX_PICKS, catalogue: TARGET_IDS.map((id) => ({ id, def: CATALOGUE[id].def, max: CATALOGUE[id].max })) });
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/daily-mission", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") }))
    return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { targets?: unknown } | null;
  const r = await savePicks(b?.targets);
  return typeof r === "string" ? Response.json({ error: r }, { status: 400 }) : Response.json({ targets: r });
}
