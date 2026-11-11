import { adminClient } from "@/lib/supabase/admin";
import { ConflictError, kickQueue, resolvePending } from "@/lib/agents";
import { outputClash } from "@/lib/tasks-recovery-pure";
import { isPhoneAct, phoneActionable } from "@/lib/ntfy-action-pure";
import { spendAct } from "@/lib/ntfy-action";
import { rateOk } from "@/lib/remote";
import { seenProblem } from "@/lib/approval-bind-pure";
import { RATE } from "@/lib/remote-web-pure";

export const dynamic = "force-dynamic";

// Approve / Reject pressed in an ntfy notification (no session: the signed one-use token is the proof). Same steps as the task
// route's approve/reject (/api/tasks/[id]): output clash check, resolvePending (Stop-all, atomic claim), then the queue and missions.
// Only single reversible actions ever get a token (ntfy-action-pure.ts), and that is checked again here against the current row.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  if (!rateOk("ntfy-act", RATE.cmd)) return fail("Too many requests: wait a minute", 429);
  const { token, action } = await req.json().catch(() => ({}));
  if (!isPhoneAct(action)) return fail("Unknown action");
  const sb = adminClient();
  if (!sb) return fail("ORBIT can't act without SUPABASE_SECRET_KEY", 503);
  const v = await spendAct(token).catch(() => ({ error: "Couldn't check the button. Open ORBIT to decide." }));
  if ("error" in v) return fail(v.error, 403);
  const { data: task, error } = await sb.from("tasks").select("status, pending").eq("user_id", v.u).eq("id", v.t).maybeSingle();
  if (error) return fail("Couldn't read the task. Open ORBIT to decide.", 503);
  if (!task || task.status !== "awaiting_approval") return fail("Already decided.", 409);
  if (!phoneActionable(task.pending)) return fail("This one needs to be read first: open ORBIT.", 409);
  if (action === "approve" && v.s !== undefined && seenProblem(task.pending ?? [], v.s)) return fail("The action changed since this notification. Nothing was run: open ORBIT.", 409); // S02
  try {
    if (action === "approve") {
      const { data: others, error: oErr } = await sb.from("tasks").select("id, status, pending").eq("user_id", v.u).eq("status", "running").neq("id", v.t).limit(100);
      if (oErr) return fail("Couldn't check competing task outputs. Nothing was run.", 503);
      const clash = outputClash(task.pending ?? [], others ?? []);
      if (clash) return fail("Another task is writing the same output right now. Approve this one in ORBIT after it finishes.", 409);
    }
    await resolvePending(sb, v.u, v.t, action === "approve");
    void kickQueue(sb, v.u);
    void import("@/lib/missions").then((m) => m.resumeMissions(sb, v.u)).catch(() => {});
    return Response.json({ ok: true, action });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed", e instanceof ConflictError ? 409 : 400);
  }
}
