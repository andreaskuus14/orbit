import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError } from "@/lib/claude";
import { approveNegotiation, closeNegotiation, contractNote, editNegotiation, listNegotiations, onReply, redraft, setLimits } from "@/lib/negotiator";

export const dynamic = "force-dynamic";

// Negotiator (roadmap B2; logic: negotiator-pure.ts, IO: negotiator.ts). GET → all negotiations.
// POST {action:"limits", ref, title, floor, ceiling, deadline?, mustHaves?, walkAway?, stepPct?} starts one or changes its limits.
// {action:"reply", id, text, intent?, lang?} records their reply (pasted by him) and drafts the next message inside his limits.
// {action:"redraft", id, intent?, lang?} | {action:"edit", id, seen, text, confirm?} | {action:"approve", id, seen} | {action:"close", id, state}.
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const out = (r: unknown) => (typeof r === "string" ? fail(r, r === "Not found" ? 404 : 400) : Response.json({ negotiation: r, note: contractNote(r as never) }));

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ negotiations: await listNegotiations() });
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/negotiator", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  try {
    switch (b.action) {
      case "limits": return out(await setLimits(b));
      case "reply": return out(await onReply(sb, user.id, b, req.signal));
      case "redraft": return out(await redraft(b, req.signal));
      case "edit": return out(await editNegotiation(b));
      case "approve": return approveNegotiation(sb, user.id, b.id, b.seen);
      case "close": return ["agreed", "lost", "walked"].includes(b.state as string) ? out(await closeNegotiation(sb, user.id, b.id, b.state as "agreed")) : fail("state must be agreed, lost or walked");
      default: return fail("action must be limits, reply, redraft, edit, approve or close");
    }
  } catch (e) {
    if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
    return fail(`Couldn't do that: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
}
