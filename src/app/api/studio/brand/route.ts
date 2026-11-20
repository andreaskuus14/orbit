import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { readBrandKit, saveBrandKit } from "@/lib/clips/brand-kit";
import { DEFAULT_KIT, isDefaultKit } from "@/lib/brand-kit-pure";

export const dynamic = "force-dynamic";

// STUDIO brand kit: GET { kit, defaults, isDefault }; PUT { kit: partial } changes only the parts sent; PUT { reset: true } restores the defaults.
// New renders pick it up; clips already rendered keep their look (publish checks warn when they differ). Nothing here uploads anything.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const kit = await readBrandKit();
  return Response.json({ kit, defaults: DEFAULT_KIT, isDefault: isDefaultKit(kit) });
}

export async function PUT(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("PUT", "/api/studio/brand", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { kit?: unknown; reset?: unknown } | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const kit = await saveBrandKit(b.kit ?? {}, b.reset === true);
  if (typeof kit === "string") return Response.json({ error: kit }, { status: 400 });
  return Response.json({ kit, defaults: DEFAULT_KIT, isDefault: isDefaultKit(kit) });
}
