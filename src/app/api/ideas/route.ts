import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError } from "@/lib/claude";
import { dismissIdea, listIdeas, radar } from "@/lib/ideas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// IDEA RADAR. GET: the board. POST {action:"radar", url} reads a YouTube video's captions and scores its ideas | {action:"dismiss", id}.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await listIdeas());
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/ideas", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return fail("JSON body required");
  if (b.action === "dismiss") return typeof b.id === "string" && (await dismissIdea(b.id)) ? Response.json(await listIdeas()) : fail("Not found", 404);
  if (b.action !== "radar" || typeof b.url !== "string") return fail("action must be radar or dismiss");
  try {
    const found = await radar(b.url, req.signal);
    return Response.json({ found: found.length, ...(await listIdeas()) });
  } catch (e) {
    if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
    return fail(e instanceof Error ? e.message : "Couldn't read that video", 502);
  }
}
