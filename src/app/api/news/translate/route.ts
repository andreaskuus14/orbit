import { requireUser } from "@/lib/supabase/server";
import { FAST_MODEL, recordUsage } from "@/lib/claude";
import { translateTitles } from "@/lib/translate";
import { MAX_BATCH, cleanTitle } from "@/lib/translate-pure";

// INTELLIGENCE headline translation. POST {items:[{id,title}], to:"en"} → {items:[{id,title,translated}], failed}.
// Already-English and cached headlines cost nothing; the rest is one haiku call. CSRF: src/middleware.ts (all /api POSTs).
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  if (body?.to !== undefined && body.to !== "en") return Response.json({ error: "Only English is supported" }, { status: 400 });
  if (!Array.isArray(body?.items)) return Response.json({ error: "Missing items" }, { status: 400 });
  const items = (body.items as unknown[]).slice(0, MAX_BATCH)
    .filter((x): x is { id: string; title: string } => typeof (x as { id?: unknown })?.id === "string" && typeof (x as { title?: unknown })?.title === "string")
    .map((x) => ({ id: x.id.slice(0, 2000), title: x.title.slice(0, 1000) }));
  const r = await translateTitles(items.map((x) => x.title), req.signal);
  if (r.usage) await recordUsage(sb, user.id, "translate", r.usage, FAST_MODEL);
  return Response.json({
    items: items.map((x, i) => ({ id: x.id, title: r.titles[i], translated: r.titles[i] !== cleanTitle(x.title) })),
    failed: r.failed,
  });
}
