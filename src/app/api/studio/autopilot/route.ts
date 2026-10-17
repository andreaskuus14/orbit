import { requireUser } from "@/lib/supabase/server";
import { startClipQueue } from "@/lib/clips/factory";
import { approve, autopilotView, clipNow, findCandidates, packageNow, patchSettings } from "@/lib/clips/autopilot";
import { scoutFail as fail } from "@/lib/clips/scout";

export const dynamic = "force-dynamic";

// YouTube autopilot: GET state (candidates, pipeline, proposals, what's working); PATCH settings;
// POST {action: "find"} | {action: "clip", videoIds} | {action: "package"} | {action: "approve", key}. Logic: src/lib/clips/autopilot.ts.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json(await autopilotView()); } catch (e) { return fail(e); }
}

export async function PATCH(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return Response.json({ error: "JSON body required" }, { status: 400 });
  try { await patchSettings(b); return Response.json(await autopilotView()); } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return Response.json({ error: "JSON body required" }, { status: 400 });
  try {
    switch (b.action) {
      case "find": await findCandidates(); return Response.json({ started: true }, { status: 202 });
      case "clip": return Response.json(await clipNow(b.videoIds));
      case "package": await packageNow(); return Response.json(await autopilotView());
      case "approve": return Response.json({ batch: await approve(b.key) }, { status: 202 });
      default: return Response.json({ error: "action must be find, clip, package or approve" }, { status: 400 });
    }
  } catch (e) { return fail(e); }
}
