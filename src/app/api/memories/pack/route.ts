import { requireUser } from "@/lib/supabase/server";
import { packView, savePack } from "@/lib/memory-pack";
import { packMarkdown } from "@/lib/memory-pack-pure";

export const dynamic = "force-dynamic";

// MEM08 project handover pack. GET ?project=X → {saved, current, outdatedSince} (data for the owner, CORE and agents);
// GET ?project=X&format=md → the saved revision (else the current one) as markdown. POST {project} → save the current pack as a revision.
// Packs never hold other projects, chat-scoped, superseded or journal/LIFE records (memory-pack-pure.ts guard). No model call.
const project = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 80) : "");
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const u = new URL(req.url), p = project(u.searchParams.get("project"));
  if (!p) return fail("project is required");
  try {
    const v = await packView(sb, user.id, p);
    if (u.searchParams.get("format") !== "md") return Response.json(v);
    return new Response(packMarkdown(v.saved ?? v.current, v.outdatedSince), { headers: { "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="handover-${p.replace(/[^\w-]+/g, "_")}.md"` } });
  } catch (e) { return fail(e instanceof Error ? e.message : "Could not build the pack", 500); }
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const p = project(Object(await req.json().catch(() => ({}))).project);
  if (!p) return fail("project is required");
  try { await savePack(sb, user.id, p); return Response.json(await packView(sb, user.id, p)); }
  catch (e) { return fail(e instanceof Error ? e.message : "Could not save the pack", 500); }
}
