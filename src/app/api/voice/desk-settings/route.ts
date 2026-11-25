import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { helperOnline, setWakeSettings, wakeSettings } from "@/lib/jarvis";
import { wakeEnvOff } from "@/lib/jarvis-pure";

export const dynamic = "force-dynamic";

// Settings → Voice: the background "Hey Orbit" listener (tools/voice). Turning it on binds it to the signed-in owner; ORBIT_WAKE=0 wins.
async function GET_() {
  const { res } = await requireUser();
  if (res) return res;
  const s = await wakeSettings();
  return Response.json({ on: s.on, peripheral: s.peripheral, everySec: s.everySec, envOff: wakeEnvOff(process.env.ORBIT_WAKE), helper: helperOnline() });
}

async function POST_(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { on?: unknown; peripheral?: unknown; everySec?: unknown } | null;
  if (!b || typeof b !== "object") return Response.json({ error: "Expected {on?, peripheral?, everySec?}" }, { status: 400 });
  const s = await setWakeSettings(user.id, { on: typeof b.on === "boolean" ? b.on : undefined, peripheral: typeof b.peripheral === "boolean" ? b.peripheral : undefined, everySec: b.everySec });
  return Response.json({ on: s.on, peripheral: s.peripheral, everySec: s.everySec, envOff: wakeEnvOff(process.env.ORBIT_WAKE), helper: helperOnline() });
}
export const GET = guard("voice/desk-settings", GET_);
export const POST = guard("voice/desk-settings", POST_);
