import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { NotAllowedError, PlaytestBusyError, decideProposal, heatmap, playtestView, runPlaytesters, setAllowed } from "@/lib/playtesters";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// AI playtesters (GAME DEV → Test → AI testers). GET: on/off, live progress, last report; GET ?img=heat: the heatmap SVG.
// POST {action:"allow", on} · {action:"run"} (starts in the background; follow it with GET) · {action:"approve"|"dismiss", id} for one fix.
// Approve is his click on that exact fix; it writes through Rojo's checked, undoable write. Nothing is published.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  if (new URL(req.url).searchParams.get("img") === "heat") {
    const svg = await heatmap(user.id);
    return svg ? new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } }) : fail("No heatmap yet", 404);
  }
  return Response.json(await playtestView(user.id));
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/playtesters", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (b?.action === "allow") {
    if (typeof b.on !== "boolean") return fail("on must be true or false");
    await setAllowed(user.id, b.on);
    return Response.json(await playtestView(user.id));
  }
  if (b?.action === "run") {
    const view = await playtestView(user.id);
    if (!view.allowed) return fail("AI playtesters are off. Switch them on first.", 403);
    if (view.live.running) return fail("Already playing.", 409);
    void runPlaytesters(user.id).catch((e) => { if (!(e instanceof PlaytestBusyError || e instanceof NotAllowedError)) console.error("[orbit] playtesters:", e); });
    return Response.json({ ...view, live: { ...view.live, running: true } });
  }
  if (b?.action === "approve" || b?.action === "dismiss") {
    if (typeof b.id !== "string" || b.id.length > 80) return fail("id is required");
    try { const note = await decideProposal(user.id, b.id, b.action === "approve"); return Response.json({ ...(await playtestView(user.id)), note }); }
    catch (e) { return fail(e instanceof Error ? e.message : String(e), 409); }
  }
  return fail("action must be allow, run, approve or dismiss");
}
