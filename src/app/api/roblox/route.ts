import { InputError, PlanError, RobloxBusyError, getHistory, makePlan, readShot, robloxConfig, runBuild, runPlaytest, runScan, studioStatus } from "@/lib/roblox";
import { MAX_KEEP, playtestGoal, scanPaths, validateItem } from "@/lib/roblox-pure";
import { requireUser } from "@/lib/supabase/server";
import { recordDevEvent } from "@/lib/dev-session";
import { eventFailed, eventFromBuild, eventFromPlaytest, eventFromScan } from "@/lib/dev-session-pure";

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
  const { sb, user, res } = await requireUser();
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
    // Builds, scans and playtests go into the GAME DEV session log (dev-session.ts), failures too; recording never fails the run.
    const log = <T,>(p: Promise<T>, label: string, source: "build" | "scan" | "playtest", ok: (r: T) => void) =>
      p.then((r) => { ok(r); return Response.json(r); }, (e: unknown) => {
        if (!(e instanceof RobloxBusyError || e instanceof PlanError || e instanceof InputError)) void recordDevEvent(sb, user.id, eventFailed(source, label, e instanceof Error ? e.message : String(e)));
        throw e;
      });
    if (body?.action === "build" && typeof body.planId === "string" && /^[0-9a-f-]{36}$/.test(body.planId)) {
      const keep = Array.isArray(body.keep) ? body.keep.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < MAX_KEEP) : undefined;
      return await log(runBuild(user.id, body.planId, keep), "Build", "build", (r) => void recordDevEvent(sb, user.id, eventFromBuild(r.label, r), r.historyId ? null : r.image));
    }
    if (body?.action === "scan") {
      const paths = scanPaths(body.paths);
      return await log(runScan(paths), `Scan: ${paths.join(", ")}`, "scan", (r) => void recordDevEvent(sb, user.id, eventFromScan(paths, r)));
    }
    if (body?.action === "playtest") {
      const g = playtestGoal(body.goal);
      if ("error" in g) return Response.json({ error: g.error }, { status: 400 });
      return await log(runPlaytest(g.goal), "Playtest", "playtest", (r) => void recordDevEvent(sb, user.id, eventFromPlaytest(g.goal, r), r.image));
    }
    return Response.json({ error: "Send {action:\"plan\", item}, {action:\"build\", planId} {action:\"scan\"} or {action:\"playtest\"}" }, { status: 400 });
  } catch (e) { return fail(e); }
}
