import { requireUser } from "@/lib/supabase/server";
import { draftVisual, getLong, listLong, longBusy, writeLong } from "@/lib/clips/longform";

export const dynamic = "force-dynamic";

// Long-form video studio. Nothing here generates or spends: "visual" only asks Higgsfield the price; approval stays in AI Story (ORBIT rule 6).
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ plans: (await listLong()).slice(0, 20), busy: longBusy() });
}

/** Body: {action:"write", topic, minutes?} | {action:"visual", id, what:{kind:"thumb",i}|{kind:"shot",ch,i}}. */
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  try {
    let out;
    if (b.action === "write") out = await writeLong(b.topic, b.minutes, req.signal);
    else if (b.action === "visual") {
      const job = typeof b.id === "string" ? await getLong(b.id) : null;
      if (!job) return Response.json({ error: "Plan not found" }, { status: 404 });
      out = await draftVisual(job, b.what);
    } else return Response.json({ error: "action must be write or visual" }, { status: 400 });
    return typeof out === "string" ? Response.json({ error: out }, { status: 409 }) : Response.json({ plan: out });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
