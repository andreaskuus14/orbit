import { requireUser } from "@/lib/supabase/server";
import { addExp, experimentsView, removeExp } from "@/lib/clips/experiments";

// STUDIO Shorts experiments: GET list with verdicts, POST {jobId, clipId, hypothesis, lesson, variants?, window?}, DELETE ?id= (failed ones are kept: 409). Local file only.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json(await experimentsView()); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Couldn't load experiments" }, { status: 502 }); }
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return Response.json({ error: "JSON body required" }, { status: 400 });
  const r = await addExp(b);
  return typeof r === "string" ? Response.json({ error: r }, { status: 400 }) : Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[0-9a-f]{12}$/.test(id)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const r = await removeExp(id);
  return typeof r === "string" ? Response.json({ error: r }, { status: r === "Experiment not found" ? 404 : 409 }) : Response.json({ ok: true });
}
