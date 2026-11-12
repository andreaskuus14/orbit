import { requireUser } from "@/lib/supabase/server";
import { parseBrief } from "@/lib/site-brief-pure";
import { editSiteCopy } from "@/lib/site-brief";
import { previewUrl, readWsFile } from "@/lib/workspace";
import { isSlug } from "@/lib/workspace-pure";

export const dynamic = "force-dynamic";

// Section editor (Puck trial). GET ?ws=slug → { brief, base } (base: the signed preview folder the editor loads pictures from).
// POST { ws, edits } → editSiteCopy: rewrites index.html, site.json and EXPORT.md only; CSS, scripts and images stay as they are.
export async function GET(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const ws = new URL(req.url).searchParams.get("ws");
  if (!isSlug(ws)) return Response.json({ error: "Invalid workspace" }, { status: 400 });
  const f = await readWsFile(user.id, ws, "site.json");
  if (!f) return Response.json({ error: `no site.json in ${ws}: build the site from a brief first` }, { status: 404 });
  let json: unknown;
  try { json = JSON.parse(f.text); } catch { return Response.json({ error: "site.json is not valid JSON" }, { status: 400 }); }
  const p = parseBrief(json);
  if ("errors" in p) return Response.json(p, { status: 400 });
  return Response.json({ brief: p.brief, base: await previewUrl(user.id, ws, "") });
}

export async function POST(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => ({}));
  if (!isSlug(b?.ws) || !Array.isArray(b?.edits) || b.edits.length > 200 || b.edits.some((e: unknown) => typeof (e as { field?: unknown })?.field !== "string" || typeof (e as { value?: unknown })?.value !== "string" || !["string", "undefined"].includes(typeof (e as { section?: unknown })?.section))) return Response.json({ error: "Missing ws or edits" }, { status: 400 });
  const saved = await readWsFile(user.id, b.ws, "site.json"); // the editor diffed against version N: don't apply it over a newer save
  let v: unknown; try { v = saved && JSON.parse(saved.text).version; } catch { /* editSiteCopy reports it */ }
  if (saved && v !== undefined && v !== b.version) return Response.json({ errors: [`the site changed since you opened it (now version ${v}); reload the editor`] }, { status: 409 });
  const r = await editSiteCopy(user.id, b.ws, b.edits);
  return "errors" in r ? Response.json(r, { status: 400 }) : Response.json({ brief: r.brief, changed: r.changed });
}
