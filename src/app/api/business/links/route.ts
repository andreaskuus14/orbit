import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { LinkError, createLink, listLinks, revokeLink } from "@/lib/pitch-links";

export const dynamic = "force-dynamic";

// BUSINESS → tracked pitch links (pitch-links.ts). GET ?contract=<id> → links + views. POST {action:"create", contractId, days?, notify?}
// | {action:"revoke", id}. Creating a link sends nothing: he copies it and sends it himself.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json({ links: await listLinks(new URL(req.url).searchParams.get("contract")) }); }
  catch (e) { return fail(e instanceof Error ? e.message : "Couldn't read links", 500); }
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business/links", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  try {
    if (b.action === "create") return Response.json(await createLink(b.contractId, b.days, b.notify));
    if (b.action === "revoke") return Response.json(await revokeLink(b.id));
    return fail("action must be create or revoke");
  } catch (e) { return fail(e instanceof LinkError ? e.message : "Couldn't do that", e instanceof LinkError ? e.status : 500); }
}
