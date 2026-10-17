import { requireUser } from "@/lib/supabase/server";
import { advance, createGoal, getGoal, goalAction, listGoals, type GoalAction, type GoalRow } from "@/lib/goals";
import { isLive, planningActive, progress, runsLeft } from "@/lib/goals-pure";
import { crossSiteBlocked } from "@/lib/csrf";

export const dynamic = "force-dynamic";

const ACTIONS: GoalAction[] = ["approve", "edit", "redraft", "ok", "proposal", "pause", "resume", "stop", "continue", "metric", "delete"];
const view = (r: GoalRow) => ({ id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, ...r.doc, planning: planningActive(r.doc) ? r.doc.planning : undefined, progress: progress(r.doc), runsLeft: runsLeft(r.doc) });

/** ?id= → one goal, else the newest 30. Opening a goal (or the list) is one of the events that advances it: no schedules. */
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try {
    const id = new URL(req.url).searchParams.get("id");
    const rows = id ? [await getGoal(sb, id)].filter((r): r is GoalRow => !!r) : await listGoals(sb, user.id);
    for (const r of rows) if (isLive(r.doc) && r.doc.status !== "blocked") void advance(sb, user.id, r.id);
    if (id) return rows[0] ? Response.json(view(rows[0])) : Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ goals: rows.map(view) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

/** No action → create a goal (its plan is drafted in the background). { action, id, ... } → the owner's clicks. */
export async function POST(req: Request) {
  // Belt and braces next to the middleware: approvals here must only ever come from ORBIT's own page.
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/goals", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "Body must be an object" }, { status: 400 });
  try {
    if (body.action === undefined) {
      const r = await createGoal(sb, user.id, body);
      return "error" in r ? Response.json(r, { status: 400 }) : Response.json(view(r.row), { status: 201 });
    }
    if (!ACTIONS.includes(body.action as GoalAction) || typeof body.id !== "string") return Response.json({ error: "action and id required" }, { status: 400 });
    const r = await goalAction(sb, user.id, body.id, body.action as GoalAction, body);
    if (r.error) return Response.json({ error: r.error }, { status: 409 });
    return Response.json(r.row ? view(r.row) : { ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
