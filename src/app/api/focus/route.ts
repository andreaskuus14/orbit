import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { dismissSummary, endFocus, focusState, startFocus } from "@/lib/focus";
import { isFocusActive } from "@/lib/dilation-pure";

export const dynamic = "force-dynamic";

// Time dilation. GET: the running block (or null) and the last "while you were focused" summary. A block that ran out is
// ended here first. POST {action:"start", minutes, goal} | {action:"end"} (end now) | {action:"dismiss"} (summary read).
async function GET_() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const f = focusState().focus;
  if (f && !isFocusActive(f, Date.now())) await endFocus(sb, f.id);
  const s = focusState();
  return Response.json({ focus: s.focus, summary: s.last, now: Date.now() });
}

async function POST_(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const r = b.action === "start" ? await startFocus(sb, user.id, b.minutes, b.goal)
    : b.action === "end" ? await endFocus(sb)
    : b.action === "dismiss" ? await dismissSummary()
    : "Unknown action";
  return typeof r === "string" ? Response.json({ error: r }, { status: 400 }) : GET();
}
export const GET = guard("focus", GET_);
export const POST = guard("focus", POST_);
