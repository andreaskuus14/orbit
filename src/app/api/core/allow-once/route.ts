import { requireUser } from "@/lib/supabase/server";
import { allowOnce } from "@/lib/durable";
import { egressTarget } from "@/lib/allow-once-pure";
import { emit } from "@/lib/claude";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

// POST { id }: the owner's "Allow once" click on a CORE egress refusal card (allow-once-pure). Signed-in owner only; CSRF: src/middleware.ts
// guards all /api/*. No CORE tool reaches this: the model, background turns, the scheduler and Auto can't create a grant.
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof b?.id === "string" && /^[0-9a-f-]{36}$/.test(b.id) ? b.id : "";
  const g = id ? allowOnce.grant(id) : null;
  if (!g) return Response.json({ error: "This refusal can no longer be allowed (expired, already used, or ORBIT restarted)" }, { status: 410 });
  void emit(sb, user.id, "policy.allow_once", "core", { tool: g.tool.slice(0, 128), target: egressTarget(g.tool).slice(0, 128), stage: "granted", journal: g.journal });
  logActivity({ area: "core", title: `Allow once granted by the owner: ${g.tool.slice(0, 80)} → ${egressTarget(g.tool).slice(0, 60)}${g.journal ? " (journal/LIFE warning shown)" : ""}` }); // tool + target, never the text
  return Response.json({ ok: true, tool: g.tool, journal: g.journal });
}
