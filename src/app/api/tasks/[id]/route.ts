import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { ConflictError, cancelTask, kickQueue, resolvePending } from "@/lib/agents";
import { cancelChain } from "@/lib/chains";
import { CHAIN_TITLE } from "@/lib/chains-pure";
import { canRetryTask } from "@/lib/completion-pure";
import { abandonPatch, cleanInput, outputClash, retryStepPatch } from "@/lib/tasks-recovery-pure";

const COLS = "id, parent_id, project_id, agent, title, request, status, result, error, trace, pending, created_at, started_at, finished_at";
type Ctx = { params: Promise<{ id: string }> };

/** Include both delegation levels so nested approvals and receipts are reachable from the root task. */
export async function GET(_: Request, { params }: Ctx) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const { id } = await params;
  const { data: task, error } = await sb.from("tasks").select(COLS).eq("user_id", user.id).eq("id", id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!task) return Response.json({ error: "Not found" }, { status: 404 });
  const { data: children, error: childError } = await sb.from("tasks").select(COLS).eq("user_id", user.id).eq("parent_id", id).order("created_at").limit(100);
  if (childError) return Response.json({ error: childError.message }, { status: 500 });
  if (!children?.length) return Response.json({ task, children: [] });
  const { data: nested, error: nestedError } = await sb.from("tasks").select(COLS).eq("user_id", user.id).in("parent_id", children.map((c) => c.id)).order("created_at").limit(100);
  if (nestedError) return Response.json({ error: nestedError.message }, { status: 500 });
  return Response.json({ task, children: [...children, ...(nested ?? [])] });
}

/** approve | reject (pending actions), retry | replace_input (rerun, nothing resolved), retry_step | resume | abandon (at the failed step), cancel (queued or running, with its sub-tasks). */
export async function POST(req: Request, { params }: Ctx) {
  const h = req.headers; // the middleware matcher skips paths ending in .png etc., so check here too
  if (crossSiteBlocked("POST", "/api/tasks", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const { id } = await params;
  const { action, request } = await req.json().catch(() => ({}));
  try {
    if (action === "approve" || action === "resume") { // OPS03: one writer per output at a time
      const { data: mine, error: mineError } = await sb.from("tasks").select("pending").eq("user_id", user.id).eq("id", id).maybeSingle();
      if (mineError) return Response.json({ error: "Couldn't check this task's outputs. No actions were run. Try again." }, { status: 503 });
      if (!mine) return Response.json({ error: "Not found" }, { status: 404 });
      const { data: others, error: othersError } = await sb.from("tasks").select("id, status, pending").eq("user_id", user.id).eq("status", "running").neq("id", id).limit(100);
      if (othersError) return Response.json({ error: "Couldn't check competing task outputs. No actions were run. Try again." }, { status: 503 });
      const clash = outputClash(mine?.pending ?? [], others ?? []);
      if (clash) return Response.json({ error: `Another task (${clash}) is writing the same output right now. Approve this one after it finishes.`, blockedBy: clash }, { status: 409 });
    }
    if (action === "retry_step" || action === "resume") { // OPS04: failed/uncertain/rejected actions only; receipts and attempt ids kept
      const { data: t, error: tErr } = await sb.from("tasks").select("pending, parent_id").eq("user_id", user.id).eq("id", id).in("status", ["failed", "cancelled"]).maybeSingle();
      if (tErr) throw tErr;
      const patch = t && retryStepPatch(t.pending ?? []);
      if (!patch) return Response.json({ error: "No failed step to retry here" }, { status: 400 });
      const { data: hit, error } = await sb.from("tasks").update(patch).eq("user_id", user.id).eq("id", id).in("status", ["failed", "cancelled"]).select("id");
      if (error) throw error;
      if (!hit?.length) return Response.json({ error: "This task changed meanwhile. Reload it." }, { status: 409 });
      // A failed (non-team) parent waits for this step again; resolvePending settles it once the step finishes.
      for (let p = t.parent_id as string | null, depth = 0; p && depth < 3; depth++) {
        const { data: up } = await sb.from("tasks").update({ status: "awaiting_approval", finished_at: null }).eq("user_id", user.id).eq("id", p).eq("status", "failed").not("title", "like", "Team: %").select("parent_id");
        p = up?.[0]?.parent_id ?? null;
      }
      if (action === "retry_step") return Response.json({ ok: true });
    }
    if (action === "abandon") {
      const { data: t } = await sb.from("tasks").select("error").eq("user_id", user.id).eq("id", id).eq("status", "failed").maybeSingle();
      if (!t) return Response.json({ error: "Only a failed task can be abandoned" }, { status: 400 });
      const { error } = await sb.from("tasks").update({ ...abandonPatch(t.error), finished_at: new Date().toISOString() }).eq("user_id", user.id).eq("id", id).eq("status", "failed");
      if (error) throw error;
      return Response.json({ ok: true });
    }
    if (action === "approve" || action === "reject" || action === "resume") {
      const pending = await resolvePending(sb, user.id, id, action !== "reject");
      void kickQueue(sb, user.id); // approved follow-up tasks start now
      void import("@/lib/missions").then((m) => m.resumeMissions(sb, user.id)).catch(() => {}); // a mission waiting on this approval moves on now (reads never drive)
      return Response.json({ pending });
    }
    if (action === "retry" || action === "replace_input") {
      const input = action === "replace_input" ? cleanInput(request) : null;
      if (action === "replace_input" && !input) return Response.json({ error: "Describe the new input (at least 5 characters)" }, { status: 400 });
      const { data: previous, error: previousError } = await sb.from("tasks").select("pending").eq("user_id", user.id).eq("id", id).maybeSingle();
      if (previousError) throw previousError;
      if (!previous || !canRetryTask(previous.pending ?? [])) return Response.json({ error: "This task has resolved actions. Keep their results and request only the unfinished work in a follow-up." }, { status: 409 });
      let parents = [id];
      for (let depth = 0; depth < 2 && parents.length; depth++) {
        const { data: children, error: childrenError } = await sb.from("tasks").select("id, pending").eq("user_id", user.id).in("parent_id", parents).limit(100);
        if (childrenError) throw childrenError;
        if (children?.length === 100 || children?.some((c) => !canRetryTask(c.pending ?? [])))
          return Response.json({ error: "Delegated work has resolved actions. Review its results and request only the unfinished work." }, { status: 409 });
        parents = (children ?? []).map((c) => c.id);
      }
      const { data, error } = await sb.from("tasks").update({ ...(input && { request: input }), status: "queued", error: null, result: null, trace: [], pending: [], started_at: null, finished_at: null })
        .eq("id", id).in("status", ["failed", "cancelled"]).is("parent_id", null).not("title", "like", "Team: %").select("id"); // a team runs its own steps (src/lib/chains.ts)
      if (error) throw error;
      if (!data?.length) return Response.json({ error: "Only failed or cancelled tasks can be retried" }, { status: 400 });
      void kickQueue(sb, user.id);
      return Response.json({ ok: true });
    }
    if (action === "cancel") {
      // RLS-scoped read first: the in-process abort must never stop another user's task.
      const { data: own } = await sb.from("tasks").select("id, title").eq("id", id).maybeSingle();
      if (own && String(own.title).startsWith(CHAIN_TITLE) && (await cancelChain(sb, id))) return Response.json({ ok: true }); // a team: stop its steps too
      if (!own || !(await cancelTask(sb, id))) return Response.json({ error: "Only queued or running tasks can be cancelled" }, { status: 400 });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: e instanceof ConflictError ? 409 : 400 });
  }
}
