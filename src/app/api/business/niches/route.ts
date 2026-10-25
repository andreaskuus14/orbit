import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError } from "@/lib/claude";
import { buildShop, nicheBoard, runScout, setNicheStatus } from "@/lib/niche";
import { isNicheId } from "@/lib/niche-pure";

export const dynamic = "force-dynamic";

// BUSINESS niche scout (weekly, also on demand) and shop-in-a-box. Local files only (niche.ts); nothing is ever published or posted.
// GET: the board. POST {action:"scout"} starts a run (poll GET while busy) | {action:"keep"|"dismiss", id} | {action:"build", id} (kept ideas only).
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json(await nicheBoard()); } catch (e) { return fail(e instanceof Error ? e.message : "Couldn't read the niche board", 500); }
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business/niches", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  if (b.action === "scout") {
    // Runs for several minutes: answer now, the drawer polls GET until busy clears.
    const started = runScout("foreground");
    const early = await Promise.race([started.then(() => null, (e: Error) => e.message), new Promise<null>((r) => setTimeout(() => r(null), 300))]);
    if (early) return fail(`Not scouting: ${early}`, 503);
    started.catch(() => {}); // its error is saved as lastError for the board
    return Response.json({ started: true }, { status: 202 });
  }
  if (!isNicheId(b.id)) return fail("id required");
  switch (b.action) {
    case "keep":
    case "dismiss":
      return (await setNicheStatus(b.id, b.action === "keep" ? "kept" : "dismissed")) ? Response.json({ ok: true }) : fail("Not found", 404);
    case "build":
      try { return Response.json({ kit: await buildShop(b.id, req.signal) }); } catch (e) {
        if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
        return fail(`Couldn't build the shop: ${e instanceof Error ? e.message : "unknown error"}`, 502);
      }
    default: return fail("action must be scout, keep, dismiss or build");
  }
}
