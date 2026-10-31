import { requireUser } from "@/lib/supabase/server";
import { addFailAck } from "@/lib/clips/fail-ack";

export const dynamic = "force-dynamic";

// Dismiss STUDIO failures (Failed list): body { keys: failKey strings }. GET /api/studio/clips returns them as failAck.
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { keys?: unknown } | null;
  const keys = Array.isArray(b?.keys) ? b.keys.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 300).slice(0, 500) : [];
  if (!keys.length) return Response.json({ error: "keys must be a non-empty list of failure keys" }, { status: 400 });
  try { return Response.json({ failAck: await addFailAck(keys) }); }
  catch (e) { return Response.json({ error: `Couldn't save the dismissal: ${(e as Error).message}` }, { status: 500 }); }
}
