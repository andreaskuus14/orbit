import { requireUser } from "@/lib/supabase/server";
import { getWeekly } from "@/lib/weekly";
import { readArchDigest } from "@/lib/arch-digest";
import { digestLine } from "@/lib/arch-digest-pure";
import { getOperatorReport } from "@/lib/operator";
import { predictionWeekLine } from "@/lib/predict";

export const dynamic = "force-dynamic";

/** GET: the weekly review (stored data only, no AI call). */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const [w, arch, guess, operator] = await Promise.all([getWeekly(sb), readArchDigest(user.id).catch(() => null), predictionWeekLine(sb, user.id), getOperatorReport(sb, user.id).catch(() => null)]); // operator: B7
  const extra = [digestLine(arch, new Date()), guess].filter(Boolean); // ARCH studio digest (5.6); how well ORBIT guessed his decisions (C4)
  return Response.json({ ...(extra.length ? { ...w, lines: [...w.lines, ...extra] } : w), operator });
}
