import { requireUser } from "@/lib/supabase/server";
import { coreEngine, envEngine, setCoreEngine } from "@/lib/core-engine";

/** Profile → CORE engine: which engine runs CORE turns (json = the default claude -p loop, mcp = Claude Code's native loop, sdk = Agent SDK). */
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ engine: coreEngine(), fallback: envEngine() });
}

/** {engine: "json" | "mcp" | "sdk" | null}: null goes back to ORBIT_CORE_ENGINE / the default. Applies from the next CORE message. */
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => ({}));
  const r = await setCoreEngine(b?.engine ?? null);
  return typeof r === "string" ? Response.json({ error: r }, { status: 400 }) : Response.json({ engine: r, fallback: envEngine() });
}
