import { requireUser } from "@/lib/supabase/server";
import { ensureDirs } from "@/lib/clips/factory";
import { devlogDir, devlogMoveProblem, readDevlog, updateDevlog } from "@/lib/clips/inbox-watch";
import { validOptions } from "@/lib/clips/pure";

export const dynamic = "force-dynamic";

// Devlog folder auto-clip (<studio>/devlog.json): recordings dropped into <inbox>/devlog become devlog-preset jobs. Default OFF.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  await ensureDirs();
  const s = await readDevlog();
  return s ? Response.json({ enabled: s.enabled, days: s.days, options: s.options, path: await devlogDir(), problem: devlogMoveProblem() })
    : Response.json({ error: "Couldn't read devlog.json (locked by another program?); try again" }, { status: 503 });
}

/** Body: { enabled, layout?, camSide?, camSize? }. Turning it on only clips recordings that arrive from now on. */
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.enabled !== "boolean") return Response.json({ error: "enabled (true/false) required" }, { status: 400 });
  const enabled = b.enabled;
  const look = Object.fromEntries((["layout", "camSide", "camSize"] as const).filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  const bad = validOptions(look);
  if (typeof bad === "string") return Response.json({ error: bad }, { status: 400 });
  try {
    const s = await updateDevlog((x) => {
      if (enabled && !x.enabled) x.since = new Date().toISOString(); // don't sweep up recordings already sitting there
      x.enabled = enabled;
      x.options = validOptions({ ...x.options, ...look }) as typeof x.options; // both halves already valid
    });
    return Response.json({ enabled: s.enabled, days: s.days, options: s.options, path: await devlogDir() });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Couldn't save" }, { status: 503 }); }
}
