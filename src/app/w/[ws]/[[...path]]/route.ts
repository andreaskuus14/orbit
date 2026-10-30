import { requireUser } from "@/lib/supabase/server";
import { readWsFile, resolvePreview } from "@/lib/workspace";
import { PREVIEW_HEADERS, contentType, previewNeedsSession, previewPath } from "@/lib/workspace-pure";

export const dynamic = "force-dynamic";

// Workspace preview: /w/<user id>.<slug>.<exp>.<sig>/<path> (7-day signed link) serves that workspace's file under a CSP sandbox (opaque origin, no access to
// ORBIT's cookies or /api). Opening a page (a document load) also needs the signed-in session; the page's own CSS/JS/images come
// from an opaque origin without cookies, so for those the signed link segment is the key. Paths are vetted by checkPath.

type Ctx = { params: Promise<{ ws: string; path?: string[] }> };
const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...PREVIEW_HEADERS } });

export async function GET(req: Request, { params }: Ctx) {
  const { ws, path = [] } = await params;
  const ref = await resolvePreview(ws);
  if (!ref) return notFound();
  if (previewNeedsSession(req.headers.get("sec-fetch-dest"))) {
    const { user, res } = await requireUser();
    if (res) return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json", ...PREVIEW_HEADERS } });
    if (user.id !== ref.uid) return notFound();
  }
  const file = previewPath(path);
  const f = await readWsFile(ref.uid, ref.slug, file);
  if (!f) return notFound();
  return new Response(new Uint8Array(f.bytes), { headers: { "Content-Type": contentType(file), ...PREVIEW_HEADERS } });
}
