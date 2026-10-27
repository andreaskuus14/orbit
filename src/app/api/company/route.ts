import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { companyView, startCompany } from "@/lib/company";
import { addCompanyTonightItem, removeCompanyTonightItem } from "@/lib/night";

export const dynamic = "force-dynamic";

// AGENT COMPANY. GET: org chart + recent company chains + tonight's queue. POST {goal}: the CEO plans and starts a chain (cancel/approve via
// /api/chains, /api/tasks/:id); POST {goal, tonight: true}: queue it for the night shift. DELETE ?tonight=<id>: unqueue.
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await companyView(sb, user.id)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 }); }
}

const blocked = (method: string, h: Headers) =>
  crossSiteBlocked(method, "/api/company", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") });

export async function DELETE(req: Request) {
  if (blocked("DELETE", req.headers)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { user, res } = await requireUser();
  if (res) return res;
  const err = await removeCompanyTonightItem(user.id, new URL(req.url).searchParams.get("tonight") ?? "");
  return err ? Response.json({ error: err }, { status: 404 }) : Response.json({ ok: true });
}

export async function POST(req: Request) {
  const h = req.headers;
  if (blocked("POST", h)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { goal?: unknown; tonight?: unknown } | null;
  try {
    if (b?.tonight === true) { const err = await addCompanyTonightItem(user.id, b.goal); return err ? Response.json({ error: err }, { status: 400 }) : Response.json({ ok: true }, { status: 201 }); }
    const r = await startCompany(sb, user.id, b?.goal);
    return "error" in r ? Response.json(r, { status: 400 }) : Response.json(r, { status: 201 });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 }); }
}
