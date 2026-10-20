import { requireUser } from "@/lib/supabase/server";
import { startClipQueue } from "@/lib/clips/factory";
import { approve, autopilotView, clipNow, editWaiting, findCandidates, packageNow, patchSettings, reviewWaiting } from "@/lib/clips/autopilot";
import { scoutFail as fail } from "@/lib/clips/scout";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

// YouTube autopilot: GET state (candidates, pipeline, proposals, what's working); PATCH settings;
// POST {action: "find"} | {action: "clip", videoIds} | {action: "package"} | {action: "approve", key, original?} | {action: "edit", key, title?, slot?} | {action: "review", key}. Logic: src/lib/clips/autopilot.ts.
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
      case "approve": {
        const batch = await approve(b.key, b.original);
        logActivity({ area: "autopilot", title: `Autopilot: you approved ${String(b.key)} for upload`, link: { panel: "studio" } });
        return Response.json({ batch }, { status: 202 });
      }
      case "edit": await editWaiting(b.key, { title: b.title, slot: b.slot }); return Response.json(await autopilotView());
      case "review": await reviewWaiting(b.key); return Response.json(await autopilotView());
      default: return Response.json({ error: "action must be find, clip, package, approve, edit or review" }, { status: 400 });
    }
  } catch (e) { return fail(e); }
}
