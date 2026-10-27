import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { actRule, listRules, runRuleNow, saveRule } from "@/lib/rules";
import { describeAction, describeTrigger, localDay, nextRun, parseRule } from "@/lib/rules-pure";

export const dynamic = "force-dynamic";

// Standing rules (Agents → Rules). GET: rules with readable trigger/action, next run and the last run's task status.
// POST {action}: parse {text} (preview only, saves nothing) | add {text} (his confirm click: re-parsed server-side, active) |
// confirm | pause | resume | delete | run {id} (run = "Run now", same runner path as a scheduled run). Every one is his own click on his own data (approval-pure EFFECTS "rules.*").
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

async function view(sb: SupabaseClient) {
  const rules = await listRules(), now = new Date();
  const ids = rules.flatMap((r) => (r.last?.taskId ? [r.last.taskId] : []));
  const { data: tasks } = ids.length ? await sb.from("tasks").select("id, status, error").in("id", ids) : { data: [] };
  return {
    rules: rules.map((r) => ({
      ...r, when: describeTrigger(r.trigger), what: describeAction(r.action),
      next: r.status === "active" && r.trigger.type === "schedule" ? nextRun(r.trigger.schedule, now)?.toISOString() ?? null : null,
      task: (tasks ?? []).find((t) => t.id === r.last?.taskId) ?? null,
      skippedToday: r.today?.day === localDay(now) ? r.today.skipped : 0,
    })),
  };
}

export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await view(sb)); } catch (e) { return fail(e instanceof Error ? e.message : "Rules failed", 500); }
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/rules", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  try {
    if (b.action === "parse" || b.action === "add") {
      if (typeof b.text !== "string" || b.text.length > 500) return fail("text is required (up to 500 characters)");
      if (b.action === "parse") {
        const p = parseRule(b.text);
        return "error" in p ? fail(p.error) : Response.json({ parsed: { ...p, when: describeTrigger(p.trigger), what: describeAction(p.action) } });
      }
      const r = await saveRule(b.text, "owner");
      if (typeof r === "string") return fail(r, 409);
    } else if (!isId(b.id)) return fail("id is required");
    else if (b.action === "confirm" || b.action === "pause" || b.action === "resume" || b.action === "delete") {
      const err = await actRule(b.id, b.action);
      if (err) return fail(err, 409);
    } else if (b.action === "run") {
      const err = await runRuleNow(sb, user.id, b.id);
      if (err) return fail(err, 409);
    } else return fail("Unknown action");
    return Response.json(await view(sb));
  } catch (e) { return fail(e instanceof Error ? e.message : "Rules failed", 500); }
}
