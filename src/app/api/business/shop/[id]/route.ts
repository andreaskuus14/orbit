import { requireUser } from "@/lib/supabase/server";
import { readShop } from "@/lib/niche";
import { SHOP_HEADERS } from "@/lib/niche-pure";

export const dynamic = "force-dynamic";

// Shop-in-a-box preview: the saved landing page under a strict CSP sandbox (no scripts, no requests); ?download=1 saves it as a file.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { res } = await requireUser();
  if (res) return res;
  const html = await readShop((await params).id);
  if (!html) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...SHOP_HEADERS } });
  const download = new URL(req.url).searchParams.has("download");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...SHOP_HEADERS, ...(download ? { "Content-Disposition": 'attachment; filename="index.html"' } : {}) } });
}
