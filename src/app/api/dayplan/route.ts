import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { accept, addTask, adjust, captureCommitments, commitments, decide, deferBlock, movePlan, planDay, review, setDone } from "@/lib/dayplan";

export const dynamic = "force-dynamic";

/** Today's plan (?fresh=1 re-plans), the evening review of the accepted plan, and the commitment inbox. Read-only outside ORBIT. */
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try {
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    const [plan, rev, inbox] = await Promise.all([planDay(sb, user.id, { fresh }), review(), commitments()]);
    return Response.json({ plan, review: rev, commitments: inbox });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Plan failed" }, { status: 500 });
  }
}

/** { move: id, before: id|null } · { defer: id, until: "tomorrow"|"week" } · { accept: true } · { overrun: id, min } · { task: text } · { done: id, value: boolean } · { capture: text } · { commitment: id, ok: boolean, due? } */
export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/dayplan", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" && v.length <= 200 ? v : null);
  const out = (r: unknown) => (typeof r === "string" ? Response.json({ error: r }, { status: 400 }) : Response.json({ ok: true, result: r }));
  if (str(b?.move)) return out(await movePlan(sb, user.id, str(b!.move)!, str(b!.before)));
  if (str(b?.defer) && (b!.until === "tomorrow" || b!.until === "week")) return out(await deferBlock(sb, user.id, str(b!.defer)!, b!.until));
  if (str(b?.overrun) && Number.isInteger(b!.min)) return out(await adjust(str(b!.overrun)!, b!.min as number));
  const kind = b?.from === "life" ? "life" : "typed"; // LIFE-panel text is private: world-pure never puts it in a prompt
  if (typeof b?.task === "string" && b.task.trim() && b.task.length <= 200) {
    const min = Number(b.min), rank = Number(b.rank), due = typeof b.due === "string" && /^\d{4}-\d\d-\d\d$/.test(b.due) ? b.due : undefined;
    return out(await addTask(b.task.trim(), { kind }, { ...(min >= 10 && min <= 240 && { min: Math.round(min) }), ...(rank >= 1 && rank <= 3 && { rank: Math.round(rank) * 10 }), ...(due && { due }) }));
  }
  if (b?.accept === true) return out(await accept());
  if (str(b?.done)) return out(await setDone(str(b!.done)!, b!.value !== false));
  if (typeof b?.capture === "string" && b.capture.trim() && b.capture.length <= 5000) return out(await captureCommitments(b.capture, { kind }));
  if (str(b?.commitment) && typeof b?.ok === "boolean") return out(await decide(str(b.commitment)!, b.ok, b.due === undefined ? undefined : String(b.due)));
  return Response.json({ error: "Expected move, accept, done, capture or commitment" }, { status: 400 });
}
