import { requireUser } from "@/lib/supabase/server";
import { patchSettings, runScoutNow, scoutFail as fail, scoutView } from "@/lib/clips/scout";

export const dynamic = "force-dynamic";

// Video Scout: GET state + picks, POST = run now (background; poll GET while running), PATCH = settings. Logic: src/lib/clips/scout.ts.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json(await scoutView()); } catch (e) { return fail(e); }
}

export async function POST() {
  const { res } = await requireUser();
  if (res) return res;
  try { await runScoutNow(); return Response.json({ started: true }, { status: 202 }); } catch (e) { return fail(e); }
}

export async function PATCH(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return Response.json({ error: "JSON body required" }, { status: 400 });
  try { await patchSettings(b); return Response.json(await scoutView()); } catch (e) { return fail(e); }
}
