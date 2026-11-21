import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { lastReport, runRedTeam } from "@/lib/redteam";
import { reportCard } from "@/lib/redteam-pure";

export const dynamic = "force-dynamic";

// RED-TEAM TWIN (OPERATIONS → Safety). GET: the last self-attack report as a card. POST {action: "run"}: run it now (mocked model
// only; the live local-model mode is ORBIT_REDTEAM_LIVE=1 at night). Nothing here sends, writes outside ORBIT or calls a hosted model.
const view = async () => { const r = await lastReport(); return { report: r, card: reportCard(r) }; };

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await view());
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/redteam", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (b?.action !== "run") return Response.json({ error: "Body must be {action: run}" }, { status: 400 });
  await runRedTeam({ live: false });
  return Response.json(await view());
}
