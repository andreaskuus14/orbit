import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { actLoop, loopsView, scanLoops } from "@/lib/loops";

export const dynamic = "force-dynamic";

/** GET → open loops from the last scan (?scan=1 rescans now; rules only, no model call). */
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try { return Response.json(new URL(req.url).searchParams.get("scan") === "1" ? await scanLoops(sb, user.id) : await loopsView(sb, user.id)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Open loops failed" }, { status: 500 }); }
}

/** { key, action: "close" | "snooze" | "task" } — his own bookkeeping; task adds it to his day plan. */
export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/loops", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const r = await actLoop(b?.key, b?.action);
  return typeof r === "string" ? Response.json({ error: r }, { status: 400 }) : Response.json({ ok: true, result: r });
}
