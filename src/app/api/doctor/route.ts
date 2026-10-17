import { runDoctor } from "@/lib/doctor";
import { bootSelfTest } from "@/lib/doctor-boot";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ORBIT doctor: every health check with a plain-English fix. Signed-in only; returns no secrets (env names only) and no log text.
// ?boot=1 → only this boot's cached self-test (what the bell uses); otherwise a fresh report plus that self-test.
export async function GET(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const boot = bootSelfTest().catch(() => null);
  if (new URL(req.url).searchParams.get("boot")) return Response.json(await boot);
  const [report, b] = await Promise.all([runDoctor(sb), boot]);
  return Response.json({ ...report, boot: b });
}
