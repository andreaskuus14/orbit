import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { safeFetch } from "@/lib/memory";
import { polite, UA } from "@/lib/reach/net";
import { parsePrice } from "@/lib/arch-materials-pure";

export const dynamic = "force-dynamic";

// ARCH materials lab "Refresh prices": POST {items:[{id,url}]} → {found:[{id,price}], failed:[{id,error}]}. Read-only GETs of public
// product pages through safeFetch (SSRF guard, size cap) at a polite pace; no login, no cookies, nothing goes to a model. The client
// shows the changes and only applies the ones the owner accepts.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/arch/prices", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { items?: unknown } | null;
  const items = (Array.isArray(b?.items) ? b.items : []).filter((x): x is { id: string; url: string } => !!x && typeof x.id === "string" && typeof x.url === "string" && /^https?:\/\//.test(x.url)).slice(0, 20);
  if (!items.length) return fail("Add a product page URL to at least one material first");
  const found: { id: string; price: number }[] = [], failed: { id: string; error: string }[] = [];
  for (const it of items) {
    try {
      const html = await polite(it.url, async () => (await (await safeFetch(it.url, "text/html", UA, 2_000_000)).res.text()));
      const price = parsePrice(html);
      if (price) found.push({ id: it.id, price }); else failed.push({ id: it.id, error: "no price found on the page" });
    } catch (e) { failed.push({ id: it.id, error: e instanceof Error ? e.message.slice(0, 120) : "fetch failed" }); }
  }
  return Response.json({ found, failed });
}
