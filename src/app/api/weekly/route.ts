import { requireUser } from "@/lib/supabase/server";
import { getWeekly } from "@/lib/weekly";
import { readArchDigest } from "@/lib/arch-digest";
import { digestLine } from "@/lib/arch-digest-pure";
import { improveView } from "@/lib/self-improve";
import { weeklyLine } from "@/lib/self-improve-pure";

export const dynamic = "force-dynamic";

/** GET: the weekly review (stored data only, no AI call). */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const [w, arch, improve] = await Promise.all([getWeekly(sb), readArchDigest(user.id).catch(() => null), improveView(sb, user.id).catch(() => null)]);
  const extra = [digestLine(arch, new Date()), weeklyLine(improve)].filter((l): l is string => !!l); // ARCH studio digest (5.6), Make ORBIT better (C6)
  return Response.json(extra.length ? { ...w, lines: [...w.lines, ...extra] } : w);
}
