import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { linkPair } from "@/lib/memory-planet-pure";

/** Suggested relationships awaiting the user's confirmation. */
export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { data, error } = await sb
    .from("memory_links")
    .select("id, status, score, reason, from:memories!memory_links_from_id_fkey(id, title), to:memories!memory_links_to_id_fkey(id, title)")
    .in("status", ["suggested", "confirmed"]).order("created_at", { ascending: false }).limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ links: data });
}

/** Confirm or reject a suggestion. Nothing becomes a permanent link without this. */
export async function PATCH(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { id, status } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || !["confirmed", "rejected"].includes(status)) return Response.json({ error: "Bad request" }, { status: 400 });
  const { data, error } = await sb.from("memory_links").update({ status }).eq("id", id).select("id");
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data?.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}

/** The owner links two memories by hand (MEMORY → a memory → Link to…): a confirmed link, or an existing suggestion in either
 *  direction turned confirmed. His own click only; nothing leaves ORBIT. */
export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/links", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { sb, res } = await requireUser();
  if (res) return res;
  const pair = linkPair(await req.json().catch(() => null));
  if (!pair) return Response.json({ error: "Bad request" }, { status: 400 });
  const { data: found, error: fe } = await sb.from("memory_links").select("id")
    .or(`and(from_id.eq.${pair.from},to_id.eq.${pair.to}),and(from_id.eq.${pair.to},to_id.eq.${pair.from})`).limit(1);
  if (fe) return Response.json({ error: fe.message }, { status: 400 });
  const q = found?.length ? sb.from("memory_links").update({ status: "confirmed" }).eq("id", found[0].id).select("id").maybeSingle()
    : sb.from("memory_links").insert({ from_id: pair.from, to_id: pair.to, status: "confirmed", reason: "linked by hand" }).select("id").maybeSingle();
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true, id: data?.id ?? null }, { status: found?.length ? 200 : 201 });
}
