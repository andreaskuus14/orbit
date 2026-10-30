import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError, askClaude } from "@/lib/claude";
import { usageHardHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { ARCH_SYSTEM, archPrompt, parseOps, parseSay, type Scene } from "@/lib/arch-pure";

export const dynamic = "force-dynamic";

// ARCH planet: POST {scene, command} → {ops, say}. The model only proposes edit ops; the client applies them and computes all cost.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/arch", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { scene?: Scene; command?: unknown } | null;
  const command = typeof b?.command === "string" ? b.command.trim() : "";
  if (!command) return fail("Say what to change");
  if (!b?.scene || !Array.isArray(b.scene.parts) || JSON.stringify(b.scene).length > 20_000) return fail("Scene missing or too big");
  const held = stopAllOn() ? "Stop-all is on" : usageHardHold();
  if (held) return fail(`Not right now: ${held}`, 503);
  try {
    const r = await askClaude(archPrompt(b.scene, command), ARCH_SYSTEM, { lane: "foreground", purpose: "arch.edit", timeoutMs: 90_000, signal: req.signal });
    const ops = parseOps(r.text);
    return ops.length ? Response.json({ ops, say: parseSay(r.text) }) : fail("CORE didn't find a change to make; try other words", 502);
  } catch (e) {
    if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
    return fail(`Couldn't edit: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
}
