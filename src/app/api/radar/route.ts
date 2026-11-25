import { safeMessage } from "@/lib/api-error-pure";
import { requireUser } from "@/lib/supabase/server";
import { radarAct, radarWindows } from "@/lib/radar";
import { windowCard } from "@/lib/radar-pure";
import { parseLang } from "@/lib/i18n-core-pure";

// Opportunity radar (radar.ts): GET the open windows as shared progress cards (+ evidence links); POST {id, act: "draft"|"later"}.
// "draft" only creates a draft task inside ORBIT; nothing is posted or sent.
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const lang = parseLang(new URL(req.url).searchParams.get("lang"));
  const now = Date.now();
  try {
    const ws = await radarWindows(sb, user.id, now);
    return Response.json({ windows: ws.map((w) => ({ id: w.id, card: windowCard(w, lang, now), evidence: w.evidence })) });
  } catch (e) { return Response.json({ error: safeMessage(e, "Radar failed") }, { status: 500 }); }
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" && /^[\w:.-]{1,80}$/.test(body.id) ? body.id : "";
  const act = body?.act === "draft" || body?.act === "later" ? body.act : null;
  if (!id || !act) return Response.json({ error: "Bad request" }, { status: 400 });
  const r = await radarAct(sb, user.id, id, act);
  return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: r.status });
}
