import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { addTonightItem, nightView, removeTonightItem, setNightSettings } from "@/lib/night";

export const dynamic = "force-dynamic";

// NIGHT SHIFT. GET: settings, tonight's queue, last night's report. POST {action:"add", text, agent?} | {action:"remove", id}
// | {action:"settings", enabled?, from?, until?, tz?, wake?, maxCalls?, maxMinutes?, idleMin?}.
// Approving what the night produced uses the existing routes (/api/tasks/:id, /api/goals), never this one.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  return Response.json(await nightView(sb, user.id));
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/night", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return fail("Body must be an object");
  const err = b.action === "add" ? await addTonightItem(user.id, { text: b.text, agent: b.agent }, "owner")
    : b.action === "remove" && typeof b.id === "string" ? await removeTonightItem(user.id, b.id)
    : b.action === "settings" ? await setNightSettings(b)
    : "action must be add, remove or settings";
  return err ? fail(err) : Response.json(await nightView(sb, user.id));
}
