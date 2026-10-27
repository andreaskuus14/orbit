import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { queueDraft } from "@/lib/clips/story";
import { buildLaunch, launchImage, readLaunchFile, readLaunches } from "@/lib/launch";
import { isPlatform } from "@/lib/launch-pure";
import { isNicheId } from "@/lib/niche-pure";

export const dynamic = "force-dynamic";

// BUSINESS → Niches → Launch package (roadmap B5). GET: saved packages | ?platform=&file= downloads one file.
// POST {action:"build", platform} writes the package (local files only) | {action:"quote", platform, index} puts that image prompt
// in STUDIO → AI Story as a priced draft: nothing is generated or spent before the owner's Approve click there.
type Ctx = { params: Promise<{ id: string }> };
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request, { params }: Ctx) {
  const { res } = await requireUser();
  if (res) return res;
  const id = (await params).id;
  if (!isNicheId(id)) return fail("Not found", 404);
  const q = new URL(req.url).searchParams;
  if (!q.has("file")) return Response.json({ launches: await readLaunches(id) });
  const f = await readLaunchFile(id, q.get("platform"), q.get("file"));
  if (!f) return fail("Not found", 404);
  const type = f.name.endsWith(".csv") ? "text/csv" : "text/markdown";
  return new Response(f.body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Disposition": `attachment; filename="${f.name}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}

export async function POST(req: Request, { params }: Ctx) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business/launch", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { res } = await requireUser();
  if (res) return res;
  const id = (await params).id;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isNicheId(id) || !b || !isPlatform(b.platform)) return fail("niche id and platform (shopify, woocommerce or etsy) required");
  if (b.action === "build") {
    try { return Response.json({ launch: await buildLaunch(id, b.platform) }); } catch (e) { return fail(e instanceof Error ? e.message : "Couldn't build the package", 409); }
  }
  if (b.action === "quote") {
    const img = await launchImage(id, b.platform, b.index);
    if (!img) return fail("Image prompt not found", 404);
    const d = await queueDraft({ kind: "image", prompt: img.prompt, aspect: img.aspect, count: 1 }).catch((e: Error) => e.message);
    return typeof d === "string" ? fail(`Couldn't ask for a quote: ${d}`, 502) : Response.json({ ok: true });
  }
  return fail("action must be build or quote");
}
