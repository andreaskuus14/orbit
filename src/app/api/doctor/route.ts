import { disk, runDoctor } from "@/lib/doctor";
import { bootSelfTest } from "@/lib/doctor-boot";
import { healthView } from "@/lib/health";
import { improveView } from "@/lib/self-improve";
import { selfEvalView } from "@/lib/self-eval";
import { ackSystemIncident, systemHealthView } from "@/lib/system-health";
import { requireUser } from "@/lib/supabase/server";
import { weeklyOutcomes, type OutcomeTask } from "@/lib/outcome-metrics-pure";
import { cantDoNow } from "@/lib/capability";

export const dynamic = "force-dynamic";

// ORBIT doctor: every health check with a plain-English fix. Signed-in only; returns no secrets (env names only). Log text appears only as the
// night health check's redacted evidence excerpts (health-pure redact), for the owner to copy to a builder.
// ?boot=1 → only this boot's cached self-test (what the bell uses); otherwise a fresh report plus that self-test.
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  // Background interruption watcher needs only local disk space, not the full CLI/network self-test.
  if (new URL(req.url).searchParams.has("interruptions")) {
    const check = await disk().catch(() => null);
    return Response.json({ checks: check ? [check] : [] });
  }
  const boot = bootSelfTest().catch(() => null);
  if (new URL(req.url).searchParams.get("boot")) return Response.json(await boot);
  const since = new Date(Date.now() - 15 * 86_400_000).toISOString(); // this + last ISO week, plus a day for redo/duplicate look-back
  const outcomes = sb.from("tasks").select("id, parent_id, agent, title, status, pending, created_at, finished_at").eq("user_id", user.id).gte("created_at", since).limit(5000)
    .then(({ data }) => (data ? weeklyOutcomes(data as OutcomeTask[], Date.now()) : null), () => null);
  const [report, b, health, improve, system, selfEval, outcome] = await Promise.all([runDoctor(sb), boot, healthView().catch(() => null), improveView(sb, user.id).catch(() => null),
    systemHealthView(sb, user.id).catch(() => null), selfEvalView().catch(() => null), outcomes]);
  const cantDo = await cantDoNow(report.checks).catch(() => null);
  return Response.json({ ...report, boot: b, health, improve, system, selfEval, outcome, cantDo });
}

// POST {ack: "<incident key>"}: the owner's "Got it" on a System health incident (no more pushes for it; it still clears by itself).
// POST {retry: "<consumer>:<event id>"}: his Retry on a dead-letter event (Saved state & events check).
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { ack?: unknown; retry?: unknown } | null;
  if (typeof b?.retry === "string") {
    const m = /^([\w-]{1,40}):(\d{1,15})$/.exec(b.retry);
    const ok = m ? await (await import("@/lib/durable")).retryEvent(m[1], Number(m[2])) : false;
    return ok ? Response.json({ ok: true }) : Response.json({ error: "Not a given-up event" }, { status: 400 });
  }
  if (typeof b?.ack !== "string" || !b.ack || b.ack.length > 100) return Response.json({ error: "ack: incident key required" }, { status: 400 });
  await ackSystemIncident(b.ack);
  return Response.json({ ok: true });
}
