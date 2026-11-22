import { requireUser } from "@/lib/supabase/server";
import { serveHeaders } from "@/lib/sandbox-pure";

export const dynamic = "force-dynamic";

// GET ?run=sb…&name=chart.png → one file a CORE sandbox run made (shown inline in the chat; kept 3 hours). Owner only; every
// file is served with a script-less sandbox CSP (an SVG can hold script) and nosniff.
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const u = new URL(req.url);
  const f = await (await import("@/lib/sandbox")).readOutput(u.searchParams.get("run"), u.searchParams.get("name"));
  if (!f) return Response.json({ error: "Not found (sandbox files are kept for 3 hours)" }, { status: 404 });
  const h = serveHeaders(f.name);
  if (u.searchParams.get("download") === "1") h["Content-Disposition"] = h["Content-Disposition"].replace(/^inline/, "attachment");
  return new Response(new Uint8Array(f.data), { headers: h });
}
