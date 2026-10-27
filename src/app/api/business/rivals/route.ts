import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { rivalsBoard, runRivals, setRivalUrls } from "@/lib/rivals";
import { isNicheId } from "@/lib/niche-pure";

export const dynamic = "force-dynamic";

// BUSINESS competitor watch (rivals.ts): weekly in the night shift, or "Check now". Read-only public pages; local files only.
// GET: the board. POST {action:"save", id, urls: string[]} (kept niches, ≤5 links) | {action:"check"} (poll GET while busy).
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json(await rivalsBoard()); } catch (e) { return fail(e instanceof Error ? e.message : "Couldn't read the competitor watch", 500); }
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business/rivals", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  if (b.action === "check") {
    const started = runRivals();
    const early = await Promise.race([started.then(() => null, (e: Error) => e.message), new Promise<null>((r) => setTimeout(() => r(null), 300))]);
    if (early) return fail(`Not checking: ${early}`, 503);
    started.catch(() => {}); // saved as lastError for the board
    return Response.json({ started: true }, { status: 202 });
  }
  if (b.action !== "save") return fail("action must be save or check");
  if (!isNicheId(b.id)) return fail("id required");
  const err = await setRivalUrls(b.id, b.urls);
  return err ? fail(err) : Response.json({ ok: true });
}
