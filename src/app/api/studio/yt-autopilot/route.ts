import { readFile } from "node:fs/promises";
import { requireUser } from "@/lib/supabase/server";
import { act, ideaFile, startResearch, view } from "@/lib/clips/explainer";

export const dynamic = "force-dynamic";

// YouTube autopilot without vidIQ (src/lib/clips/explainer.ts): GET state (progress cards, ideas, last research report);
// GET ?id=…&file=style-1|style-2|style-3|motion → that idea's preview file; POST {action: "research", niche} starts a research run;
// POST {action, id} for a card's button (approvals are only this owner-only route). Nothing here uploads or posts.
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const u = new URL(req.url), id = u.searchParams.get("id"), which = u.searchParams.get("file");
  if (id && which) {
    const f = await ideaFile(id, which);
    if (!f) return Response.json({ error: "not found" }, { status: 404 });
    try {
      const body = await readFile(f);
      return new Response(new Uint8Array(body), { headers: { "Content-Type": which === "motion" ? "video/mp4" : "image/png", "Cache-Control": "no-store" } });
    } catch { return Response.json({ error: "not found" }, { status: 404 }); }
  }
  return Response.json(await view());
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return Response.json({ error: "JSON body required" }, { status: 400 });
  if (b.action === "research") {
    const r = await startResearch(b);
    return r.started ? Response.json({ started: true }, { status: 202 }) : Response.json({ error: r.error }, { status: 409 });
  }
  const r = await act(b.id, b.action);
  return "error" in r ? Response.json({ error: r.error }, { status: r.status }) : Response.json(await view());
}
