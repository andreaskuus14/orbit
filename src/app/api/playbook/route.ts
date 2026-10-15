import { requireUser } from "@/lib/supabase/server";
import { loadPlaybookRow, mutatePlaybook, PlaybookError, PLAYBOOK_MISSING_MSG } from "@/lib/playbook";
import { validateRules } from "@/lib/playbook-pure";

const fail = (e: unknown) =>
  e instanceof PlaybookError
    ? Response.json({ error: e.message, available: e.status !== 503 }, { status: e.status })
    : Response.json({ error: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e) }, { status: 500 });

const out = (r: { rules: string[]; version: number; history: unknown[] }) =>
  ({ available: true, rules: r.rules, version: r.version, history: [...r.history].reverse() }); // newest first

/** CORE's learned rules. {available:false} until migration 0007 is applied. */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try {
    return Response.json(out(await loadPlaybookRow(sb, user.id)));
  } catch (e) {
    if (e instanceof PlaybookError && e.status === 503) return Response.json({ available: false, message: PLAYBOOK_MISSING_MSG, rules: [], version: 0, history: [] });
    return fail(e);
  }
}

/** {action:"set", rules, version} (409 if version is stale) | {action:"revert", version} | {action:"clear"}. User edits pass the same safety checks as CORE's. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "set") {
      const v = validateRules(body.rules);
      if (v.rejected.length) {
        return Response.json({ error: `Not saved. ${v.rejected.map((r) => `"${r.rule.slice(0, 60)}" ${r.reason}`).join("; ")}.`, rejected: v.rejected }, { status: 400 });
      }
      if (typeof body.version !== "number") return Response.json({ error: "version is required" }, { status: 400 });
      return Response.json(out(await mutatePlaybook(sb, user.id, (cur) => {
        if (cur.version !== body.version) throw new PlaybookError("CORE updated the rules meanwhile. Reloaded the latest version; please redo your edit.", 409);
        return JSON.stringify(cur.rules) === JSON.stringify(v.rules) ? null : v.rules;
      }, "user")));
    }
    if (body.action === "clear") return Response.json(out(await mutatePlaybook(sb, user.id, (cur) => (cur.rules.length ? [] : null), "user:clear")));
    if (body.action === "revert") {
      const target = Number(body.version);
      const r = await mutatePlaybook(sb, user.id, (cur) => {
        const h = cur.history.find((x) => x.version === target);
        if (!h) throw new PlaybookError(`Version ${body.version} is not in history`, 404);
        return validateRules(h.rules).rules; // re-checked in case the rules changed since
      }, `revert:v${target}`);
      return Response.json(out(r));
    }
    return Response.json({ error: 'action must be "set", "revert" or "clear"' }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
