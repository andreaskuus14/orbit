import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// DEEP RESEARCH (research.ts). GET → { cards } (the shared "Working on it" cards, newest first, finished ones for 24 h).
// POST {action:"stop", id?} → stops it (what was already read is written up and saved). Starting is CORE's deep_research tool.
async function GET_() {
  const { res } = await requireUser();
  if (res) return res;
  const { researchCards } = await import("@/lib/research");
  return Response.json({ cards: researchCards() });
}

async function POST_(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = ((await req.json().catch(() => null)) ?? {}) as { action?: string; id?: unknown };
  if (b.action !== "stop") return Response.json({ error: "Unknown action" }, { status: 400 });
  const { stopResearch } = await import("@/lib/research");
  return Response.json({ ok: stopResearch(typeof b.id === "string" ? b.id : undefined) });
}
export const GET = guard("research", GET_);
export const POST = guard("research", POST_);
