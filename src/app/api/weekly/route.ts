import { requireUser } from "@/lib/supabase/server";
import { getWeekly } from "@/lib/weekly";
import { readArchDigest } from "@/lib/arch-digest";
import { digestLine } from "@/lib/arch-digest-pure";

export const dynamic = "force-dynamic";

/** GET: the weekly review (stored data only, no AI call). */
export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const [w, arch] = await Promise.all([getWeekly(sb), readArchDigest(user.id).catch(() => null)]);
  const line = digestLine(arch, new Date()); // ARCH studio digest (5.6), one line
  return Response.json(line ? { ...w, lines: [...w.lines, line] } : w);
}
