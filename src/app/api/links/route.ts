import { requireUser } from "@/lib/supabase/server";

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
