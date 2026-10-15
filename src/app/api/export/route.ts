import { requireUser } from "@/lib/supabase/server";
import { buildExport } from "@/lib/backup";

/** Download everything ORBIT stores about you as JSON, plus 1-hour links to your uploaded files. */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try {
    const body = await buildExport(sb, user, true);
    return new Response(JSON.stringify(body, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="orbit-export-${body.exported_at.slice(0, 10)}.json"` },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Export failed" }, { status: 500 });
  }
}
