import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { draftPatch } from "@/lib/self-improve-patch";

export const dynamic = "force-dynamic";

// POST {key}: the owner's click on a "Make ORBIT better" task → one model call drafts a reviewable patch, saved locally (never applied).
export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/self-improve", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") }))
    return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const key = ((await req.json().catch(() => ({}))) as { key?: unknown }).key;
  if (typeof key !== "string" || !key || key.length > 200) return Response.json({ error: "Missing task key" }, { status: 400 });
  const r = await draftPatch(sb, user.id, key);
  return Response.json(r, { status: "error" in r ? 409 : 200 });
}
