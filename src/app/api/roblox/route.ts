import { InputError, PlanError, RobloxBusyError, getHistory, makePlan, readShot, robloxConfig, runBuild, runPlaytest, runScan, studioStatus } from "@/lib/roblox";
import { MAX_KEEP, playtestGoal, scanPaths, validateItem } from "@/lib/roblox-pure";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 480; // map plans/builds may take 7 minutes

const fail = (e: unknown) => {
  const status = e instanceof RobloxBusyError ? 409 : e instanceof PlanError ? 410 : e instanceof InputError ? 400 : 502;
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
};

// Roblox Studio bridge. GET ?status=1: configured + Studio open (cached 30 s). POST {action:"plan", item} → dry run with read-only
// tools; POST {action:"build", planId, keep?} → carries out that confirmed plan (keep = ticked scene object indexes);
// POST {action:"scan", paths?} → read-only free-model scan of Workspace paths (default Workspace.ORBIT Builds);
// POST {action:"playtest", goal?} → look-only play-mode run (start, walk, console, stop) returning findings. Signed-in only; CSRF is checked by middleware.
// GET ?history=1 → the last 30 builds' before/after rows; GET ?shot=<id>&side=before|after → that PNG.
export async function GET(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams;
  if (q.get("history") === "1") return Response.json({ history: (await getHistory(user.id).catch(() => [])).reverse() });
  if (q.has("shot")) {
    const png = await readShot(user.id, q.get("shot"), q.get("side"));
    return png ? new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } })
      : Response.json({ error: "Screenshot not found" }, { status: 404 });
  }
  const cfg = robloxConfig();
  if (!cfg.configured) return Response.json({ configured: false, help: cfg.help });
  if (q.get("status") !== "1") return Response.json({ configured: true });
  return Response.json({ configured: true, studio: await studioStatus() });
}

export async function POST(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const cfg = robloxConfig();
  if (!cfg.configured) return Response.json({ configured: false, help: cfg.help, error: "The Roblox Studio bridge isn't set up yet." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { action?: unknown; item?: unknown; planId?: unknown; keep?: unknown; paths?: unknown; goal?: unknown } | null;
  try {
    if (body?.action === "plan") {
      const v = validateItem(body.item);
      if ("error" in v) return Response.json({ error: v.error }, { status: 400 });
      return Response.json(await makePlan(user.id, v.item));
    }
    if (body?.action === "build" && typeof body.planId === "string" && /^[0-9a-f-]{36}$/.test(body.planId)) {
      const keep = Array.isArray(body.keep) ? body.keep.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < MAX_KEEP) : undefined;
      return Response.json(await runBuild(user.id, body.planId, keep));
    }
    if (body?.action === "scan") return Response.json(await runScan(scanPaths(body.paths)));
    if (body?.action === "playtest") {
      const g = playtestGoal(body.goal);
      if ("error" in g) return Response.json({ error: g.error }, { status: 400 });
      return Response.json(await runPlaytest(g.goal));
    }
    return Response.json({ error: "Send {action:\"plan\", item}, {action:\"build\", planId} {action:\"scan\"} or {action:\"playtest\"}" }, { status: 400 });
  } catch (e) { return fail(e); }
}
