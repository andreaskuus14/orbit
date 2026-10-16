import { requireUser } from "@/lib/supabase/server";
import { runNicheNow, scoutFail as fail, scoutView, useNiche } from "@/lib/clips/scout";

export const dynamic = "force-dynamic";

// Niche finder: POST {} = research now (background, ≤ ~412 YouTube units; poll GET ../ while running); POST { use: niche name } = its keywords become the AI keywords.
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => ({}))) as { use?: unknown } | null;
  try {
    if (b?.use !== undefined) { await useNiche(b.use); return Response.json(await scoutView()); }
    await runNicheNow();
    return Response.json({ started: true }, { status: 202 });
  } catch (e) { return fail(e); }
}
