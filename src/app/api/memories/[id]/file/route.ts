import { requireUser } from "@/lib/supabase/server";

/** Open the original uploaded file through a short-lived private link. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { id } = await params;
  const { data } = await sb.from("memories").select("storage_path").eq("id", id).maybeSingle();
  if (!data?.storage_path) return Response.json({ error: "No file for this memory" }, { status: 404 });
  const { data: signed, error } = await sb.storage.from("vault").createSignedUrl(data.storage_path, 60);
  if (error || !signed) return Response.json({ error: error?.message ?? "Could not open file" }, { status: 500 });
  return Response.redirect(signed.signedUrl, 302);
}
