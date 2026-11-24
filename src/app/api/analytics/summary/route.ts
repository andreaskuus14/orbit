import { requireUser } from "@/lib/supabase/server";
import { loadSummary } from "@/lib/analytics-summary";
import { parseDays } from "@/lib/analytics-summary-pure";

export const dynamic = "force-dynamic";

// GET ?days=7|30 → the ANALYTICS planet in one reply, totalled here (no task or usage rows go to the browser).
export async function GET(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  try {
    return Response.json(await loadSummary(sb, parseDays(new URL(req.url).searchParams.get("days"))), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[orbit] analytics summary failed", e);
    return Response.json({ error: "Could not read your tasks" }, { status: 500 });
  }
}
