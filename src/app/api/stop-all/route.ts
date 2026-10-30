import { requireUser } from "@/lib/supabase/server";
import { stopAllState } from "@/lib/stop-all";
import { switchStopAll } from "@/lib/stop-all-run";
import { usageView } from "@/lib/usage-meter";
import { lastBeat } from "@/lib/host-heartbeat";

export const dynamic = "force-dynamic";

// Global Stop-all. GET: {stop, hold, limit, host} (host: last scheduler heartbeat ISO or null) (the HUD polls it: banner + bell on a usage limit). POST {on: boolean}.
// On: every entry point refuses new work (see src/lib/stop-all.ts); running agent tasks / team chains / goal steps are cancelled
// through their normal cancel paths. Clip renders and uploads already under way finish (killing them could leave broken files).
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const u = usageView();
  return Response.json({ stop: stopAllState(), hold: u.hold, limit: u.limit, host: lastBeat() });
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const on = ((await req.json().catch(() => null)) as { on?: unknown } | null)?.on;
  if (typeof on !== "boolean") return Response.json({ error: "on must be true or false" }, { status: 400 });
  return Response.json(await switchStopAll(sb, user.id, on));
}
