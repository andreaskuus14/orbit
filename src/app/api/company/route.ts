import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { companyView, startCompany } from "@/lib/company";

export const dynamic = "force-dynamic";

// AGENT COMPANY. GET: org chart + recent company chains. POST {goal}: the CEO plans and starts a chain (cancel/approve via /api/chains, /api/tasks/:id).
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await companyView(sb, user.id)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 }); }
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/company", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { goal?: unknown } | null;
  try {
    const r = await startCompany(sb, user.id, b?.goal);
    return "error" in r ? Response.json(r, { status: 400 }) : Response.json(r, { status: 201 });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 }); }
}
