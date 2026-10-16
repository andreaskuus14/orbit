import { requireUser } from "@/lib/supabase/server";
import { ensureDirs } from "@/lib/clips/factory";
import { readInboxAuto, updateInboxAuto } from "@/lib/clips/inbox-watch";
import { validOptions } from "@/lib/clips/pure";

export const dynamic = "force-dynamic";

// Auto-clip for files dropped into the inbox: { enabled, options, since } in <studio>/inbox-auto.json.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  await ensureDirs();
  const s = await readInboxAuto();
  return s ? Response.json(s) : Response.json({ error: "Couldn't read inbox-auto.json (locked by another program?); try again" }, { status: 503 });
}

/** Body: { enabled, ...clip options }. Turning it on saves the options and only clips files that arrive from now on. */
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || typeof b.enabled !== "boolean") return Response.json({ error: "enabled (true/false) required" }, { status: 400 });
  const options = validOptions(b);
  if (typeof options === "string") return Response.json({ error: options }, { status: 400 });
  try {
    const s = await updateInboxAuto((x) => {
      if (b.enabled && !x.enabled) x.since = new Date().toISOString(); // don't sweep up the backlog sitting there while it was off
      Object.assign(x, { enabled: b.enabled, options });
    });
    return Response.json(s);
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Couldn't save" }, { status: 503 }); }
}
