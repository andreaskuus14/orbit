import { requireUser } from "@/lib/supabase/server";
import { autonomyState, cancelAuto, setAreaLevel, setLimits } from "@/lib/autonomy";
import { stopAllOn } from "@/lib/stop-all";
import { pushProblem } from "@/lib/remote-push";
import { TZ } from "@/lib/autonomy-pure";
import { localClock } from "@/lib/night-pure";

export const dynamic = "force-dynamic";

// Profile → Autonomy. GET: levels, limits, queued auto actions, today's autonomy.act events (ledger), Stop-all.
// POST {action:"level", area, level, confirm?} | {action:"limits", sendPerDay?, publishPerDay?} | {action:"cancel", id}.
export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const s = autonomyState(), day = localClock(Date.now(), TZ).day;
  const r = await sb.from("events").select("created_at, payload").eq("type", "autonomy.act").gte("created_at", new Date(Date.now() - 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(100);
  const today = (r.data ?? []).filter((e) => localClock(Date.parse(e.created_at), TZ).day === day).map((e) => ({ at: e.created_at, ...(e.payload as object) }));
  return Response.json({ levels: s.levels, limits: s.limits, pending: s.pending, today, stopAll: stopAllOn(), push: pushProblem() });
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const r = b.action === "level" ? await setAreaLevel(sb, user.id, b.area, b.level, b.confirm)
    : b.action === "limits" ? await setLimits(b)
    : b.action === "cancel" ? await cancelAuto(b.id)
    : "Unknown action";
  return typeof r === "string" ? Response.json({ error: r }, { status: 400 }) : GET();
}
