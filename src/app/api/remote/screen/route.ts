import { deviceFromCookie, ownerClient, pendingApprovals, rateOk, remoteProblem } from "@/lib/remote";
import { deviceType, scopeAllows, screenView, type TaskRow } from "@/lib/screen-pure";
import { stopAllState } from "@/lib/stop-all";
import { composeToday } from "@/lib/brief";
import { nightView } from "@/lib/night";
import { liveFocus } from "@/lib/life";
import { allows } from "@/lib/autonomy";

export const dynamic = "force-dynamic";

// GET: the read-only second screen's dashboard (/screen polls it every 30 s). Same device cookie as the phone remote; the
// scope check lets a screen (or a phone) read this. Titles and counts only, shaped by screen-pure: no bodies, amounts, journal.
const fail = (error: string, status: number) => Response.json({ error }, { status });
const soft = <T,>(p: Promise<T>, ms = 6000) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch((e) => { console.error("[screen]", e instanceof Error ? e.message : e); return null; });

export async function GET() {
  const problem = remoteProblem();
  if (problem) return fail(problem, 503);
  const device = await deviceFromCookie(true);
  if (!device) return fail("Not paired", 401);
  if (!scopeAllows(deviceType(device), "screen")) return fail("Not allowed", 403);
  if (!rateOk(`screen:${device.id}`, { limit: 12, windowMs: 60_000 })) return fail("Too many refreshes", 429);
  let sb;
  try { sb = await ownerClient(device.userId); } catch (e) { console.error("[screen] owner session:", e instanceof Error ? e.message : e); return fail("The PC can't read ORBIT for you right now", 503); }
  const [brief, tasks, approvals, night] = await Promise.all([
    allows("brief", "background", { stopAll: false }).ok ? soft(composeToday(sb, device.userId)) : null, // Profile → Autonomy: brief Off
    soft(Promise.resolve(sb.from("tasks").select("id, parent_id, agent, title, status, started_at").in("status", ["queued", "running", "awaiting_approval"])
      .order("created_at", { ascending: false }).limit(60)).then((r) => { if (r.error) throw r.error; return (r.data ?? []) as TaskRow[]; })),
    soft(pendingApprovals(sb)),
    soft(nightView(sb, device.userId)),
  ]);
  return Response.json({
    ...screenView({
      stop: stopAllState(), brief, tasks: tasks ?? [], approvals: approvals ?? [],
      night: night && { ...night.settings, running: night.running, queued: night.tonight.length, report: night.report },
      focus: liveFocus(),
    }, Date.now()),
    at: Date.now(),
  });
}
