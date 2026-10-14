import { requireUser } from "@/lib/supabase/server";
import { MEMORY_COLUMNS } from "@/lib/memory";

/** Download everything ORBIT stores about you as JSON. */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const [memories, links, profile] = await Promise.all([
    sb.from("memories").select(MEMORY_COLUMNS),
    sb.from("memory_links").select("from_id, to_id, status, score, created_at"),
    sb.from("profiles").select("*").eq("id", user.id).maybeSingle(),
  ]);
  const err = memories.error || links.error || profile.error;
  if (err) return Response.json({ error: err.message }, { status: 500 });
  return new Response(JSON.stringify({ exported_at: new Date().toISOString(), profile: profile.data, memories: memories.data, links: links.data }, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="orbit-export.json"' },
  });
}
