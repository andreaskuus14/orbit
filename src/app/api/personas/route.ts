import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { PersonaBusyError, calibratePersonas, personaView, runPersonaPlaytest, setPersonaContext } from "@/lib/personas";
import { MAX_CONTEXT } from "@/lib/personas-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Persona playtest (GAME DEV → Personas). GET: pasted context, last report, running. POST {action:"context", context} saves the owner's
// pasted UI text/scripts; POST {action:"calibrate"} fits calibration factors against his imported analytics; POST {action:"run"} runs a simulated-only playtest now (real Studio runs happen in the night shift slot).
// Proposals are added to the backlog by the client through /api/devworld, only on the owner's click.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { user, res } = await requireUser();
  if (res) return res;
  return Response.json(await personaView(user.id));
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/personas", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (b?.action === "context") {
    if (typeof b.context !== "string" || b.context.length > MAX_CONTEXT) return fail(`context must be text of at most ${MAX_CONTEXT} characters`);
    await setPersonaContext(user.id, b.context);
    return Response.json(await personaView(user.id));
  }
  if (b?.action === "run") {
    try {
      await runPersonaPlaytest(sb, user.id, { studioRuns: 0, day: new Date().toISOString().slice(0, 10), signal: req.signal });
      return Response.json(await personaView(user.id));
    } catch (e) { return fail(e instanceof Error ? e.message : String(e), e instanceof PersonaBusyError ? 409 : 502); }
  }
  if (b?.action === "calibrate") {
    try { await calibratePersonas(sb, user.id); return Response.json(await personaView(user.id)); } catch (e) { return fail(e instanceof Error ? e.message : String(e), 409); }
  }
  return fail("action must be context, run or calibrate");
}
