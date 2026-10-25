import { requireUser } from "@/lib/supabase/server";
import { runLuau } from "@/lib/luau";
import { BusyError } from "@/lib/claude";
import { parseLuauRequest } from "@/lib/luau-pure";
import { recordDevEvent } from "@/lib/dev-session";
import { eventFromLuau } from "@/lib/dev-session-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 420 // smart-model CLI timeout is 360 s, plus queue time;

// DevWorld Luau Code Helper. POST { mode: "write", request, kind, parent } | { mode: "fix", code, error, kind } | { mode: "explain", code }
// → { mode, code, notes, flags, diff, sources } or { mode: "explain", text }. Nothing is written into Studio.
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const r = parseLuauRequest(await req.json().catch(() => null));
  if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
  try {
    const out = await runLuau(sb, user.id, r, req.signal);
    void recordDevEvent(sb, user.id, eventFromLuau(r, out)); // the GAME DEV session log (best effort)
    return Response.json(out);
  } catch (e) {
    if (e instanceof BusyError) return Response.json({ error: e.message }, { status: 429 });
    console.error("[orbit] luau helper failed", e);
    return Response.json({ error: "The Luau helper couldn't finish. Try again in a moment." }, { status: 502 });
  }
}
