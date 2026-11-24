import { safeMessage } from "@/lib/api-error-pure";
import { requireUser } from "@/lib/supabase/server";
import { markCandidate, prototypeCandidate, runFeatureScout, scoutBoard, scoutGlowing } from "@/lib/feature-scout";
import { stopAllOn } from "@/lib/stop-all";

export const dynamic = "force-dynamic";

// OPERATIONS → Scout (feature-scout.ts). GET: the board ({glowing} only with ?count=1, for the galaxy's moons).
// POST {action:"open"|"dismiss"|"prototype", key} | {action:"run"}. "prototype" creates one agent task (his click); nothing is installed.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  if (new URL(req.url).searchParams.get("count")) return Response.json({ glowing: process.env.ORBIT_SCOUT?.trim() === "0" ? 0 : await scoutGlowing() });
  try { return Response.json(await scoutBoard()); } catch (e) { return fail(safeMessage(e, "Couldn't read the scout board"), 500); }
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  if (b.action === "run") {
    if (process.env.ORBIT_SCOUT?.trim() === "0") return fail("The feature scout is off (ORBIT_SCOUT=0)", 409);
    if (stopAllOn()) return fail("ORBIT is paused (Stop-all is on)", 409);
    void runFeatureScout(sb, user.id).catch((e) => console.error("[orbit] feature scout (manual) failed:", e instanceof Error ? e.message : e));
    return Response.json({ started: true });
  }
  const key = typeof b.key === "string" ? b.key.slice(0, 200) : "";
  if (!key) return fail("key required");
  if (b.action === "open" || b.action === "dismiss") return Response.json({ ok: await markCandidate(key, b.action === "open" ? "opened" : "dismissed") });
  if (b.action === "prototype") { const r = await prototypeCandidate(sb, user.id, key); return "error" in r ? fail(r.error, r.status) : Response.json(r); }
  return fail("action must be run, open, dismiss or prototype");
}
