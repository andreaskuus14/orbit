import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ARCH precedent library (roadmap 5.4): GET → {rows} = the owner's memories tagged "arch" (lessons, scans, sketch critiques).
// Linking and search happen client-side in arch-studio-pure (a few hundred rows at most).
export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { data, error } = await sb.from("memories").select("id, title, content, tags, created_at, storage_path").contains("tags", ["arch"]).order("created_at", { ascending: false }).limit(300);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rows: data ?? [] });
}
