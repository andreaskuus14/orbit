import { disk, runDoctor } from "@/lib/doctor";
import { bootSelfTest } from "@/lib/doctor-boot";
import { healthView } from "@/lib/health";
import { improveView } from "@/lib/self-improve";
import { requireUser } from "@/lib/supabase/server";

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
  const [report, b, health, improve] = await Promise.all([runDoctor(sb), boot, healthView().catch(() => null), improveView(sb, user.id).catch(() => null)]);
  return Response.json({ ...report, boot: b, health, improve });
}
