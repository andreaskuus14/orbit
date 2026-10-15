import { requireUser } from "@/lib/supabase/server";
import { BUILTIN_AGENTS } from "@/lib/agents";
import { PROPOSAL_COLS, MISSING_TABLE_MSG, ProposalError, approveProposal, dismissProposal, generateProposalsNow } from "@/lib/proactive";
import { isMissingTable } from "@/lib/proactive-pure";

const agentName = (slug: string) => BUILTIN_AGENTS.find((a) => a.slug === slug)?.name ?? slug;
const fail = (e: unknown) =>
  e instanceof ProposalError
    ? Response.json({ error: e.message, available: e.status !== 503 }, { status: e.status })
    : Response.json({ error: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e) }, { status: 500 });

/** Pending suggestions plus those decided in the last 7 days. {available:false} until migration 0006 is applied. */
export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data, error } = await sb.from("proposals").select(PROPOSAL_COLS)
    .or(`status.eq.pending,decided_at.gte.${since}`).order("created_at", { ascending: false }).limit(40);
  if (error) {
    if (isMissingTable(error)) return Response.json({ available: false, message: MISSING_TABLE_MSG, proposals: [] });
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ available: true, proposals: (data ?? []).map((p) => ({ ...p, agent_name: agentName(p.agent) })) });
}

/** {id, action: "approve"|"dismiss"} or {action: "generate"} (rate-limited). */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "generate") {
      const created = await generateProposalsNow(sb, user.id);
      return Response.json({ created: created.map((p) => ({ ...p, agent_name: agentName(p.agent) })) });
    }
    if (typeof body.id !== "string" || !body.id) return Response.json({ error: "id is required" }, { status: 400 });
    if (body.action === "approve") return Response.json({ proposal: await approveProposal(sb, user.id, body.id) });
    if (body.action === "dismiss") return Response.json({ proposal: await dismissProposal(sb, user.id, body.id) });
    return Response.json({ error: 'action must be "approve", "dismiss" or "generate"' }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
