import { PlanError, RobloxBusyError, makePlan, robloxConfig, runBuild, studioStatus } from "@/lib/roblox";
import { validateItem } from "@/lib/roblox-pure";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const fail = (e: unknown) => {
  const status = e instanceof RobloxBusyError ? 409 : e instanceof PlanError ? 410 : 502;
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
};

// Roblox Studio bridge. GET ?status=1: configured + Studio open (cached 30 s). POST {action:"plan", item} → dry run with read-only
// tools; POST {action:"build", planId} → carries out that confirmed plan. Signed-in only; CSRF is checked by middleware.
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const cfg = robloxConfig();
  if (!cfg.configured) return Response.json({ configured: false, help: cfg.help });
  if (new URL(req.url).searchParams.get("status") !== "1") return Response.json({ configured: true });
  return Response.json({ configured: true, studio: await studioStatus() });
}

export async function POST(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const cfg = robloxConfig();
  if (!cfg.configured) return Response.json({ configured: false, help: cfg.help, error: "The Roblox Studio bridge isn't set up yet." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { action?: unknown; item?: unknown; planId?: unknown } | null;
  try {
    if (body?.action === "plan") {
      const v = validateItem(body.item);
      if ("error" in v) return Response.json({ error: v.error }, { status: 400 });
      return Response.json(await makePlan(user.id, v.item));
    }
    if (body?.action === "build" && typeof body.planId === "string" && /^[0-9a-f-]{36}$/.test(body.planId)) {
      return Response.json(await runBuild(user.id, body.planId));
    }
    return Response.json({ error: "Send {action:\"plan\", item} or {action:\"build\", planId}" }, { status: 400 });
  } catch (e) { return fail(e); }
}
