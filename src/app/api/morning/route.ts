import { requireUser } from "@/lib/supabase/server";
import { getMorning, getSince } from "@/lib/morning";
import { parseSince } from "@/lib/morning-pure";
import { ledgerIssue } from "@/lib/ledger-pure";
import { emit } from "@/lib/claude";

/** The "Good morning" briefing: card sections plus a template-built spoken version (no AI call).
 *  ?since=<ms> adds the "since you left" section; with &recap=1 only that section is gathered and returned. */
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  void import("@/lib/goals").then((g) => g.resumeGoals(sb, user.id)).catch(() => {}); // opening ORBIT is one of the events that advances goals
  const q = new URL(req.url).searchParams, now = Date.now(), from = parseSince(q.get("since"), now);
  try {
    if (q.get("recap") === "1") return from === null ? Response.json({ error: "since is required" }, { status: 400 }) : Response.json({ since: await getSince(sb, from, now) });
    return Response.json(await getMorning(sb, user.id, now, from));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Briefing failed" }, { status: 500 });
  }
}

/** 👍/👎 on a morning card: { kind, key, up } → ledger "morning.thumb". A hero/card open or "done": { event: "click" | "done", source, key }
 *  → "morning.click" / "morning.done". The next briefing's ranking reads all three. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { kind?: unknown; key?: unknown; up?: unknown; event?: unknown; source?: unknown } | null;
  const type = b?.event === "click" ? "morning.click" : b?.event === "done" ? "morning.done" : "morning.thumb";
  const data = type === "morning.thumb" ? { kind: b?.kind, key: b?.key, up: b?.up } : { source: b?.source, key: b?.key };
  const issue = ledgerIssue(type, "core", data);
  if (issue) return Response.json({ error: issue }, { status: 400 });
  await emit(sb, user.id, type, "core", data);
  return Response.json({ ok: true });
}
