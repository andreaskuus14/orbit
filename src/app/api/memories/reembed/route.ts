import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { embed, embeddingProvider } from "@/lib/embeddings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/memories/reembed?offset=0 → re-embeds up to 40 of the caller's memories with the current provider.
// Needed once after switching provider (vectors from different models can't be compared). Call again with next until done.
const BATCH = 40;
export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/memories/reembed", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { sb, res } = await requireUser();
  if (res) return res;
  const offset = Math.max(0, Number(new URL(req.url).searchParams.get("offset")) || 0);
  const { data, error } = await sb.from("memories").select("id,title,content,kind").order("created_at", { ascending: true }).range(offset, offset + BATCH - 1);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let done = 0, failed = 0;
  for (const m of data ?? []) {
    const e = await embed(`${m.title}\n\n${m.content}`, "document", m.kind);
    if (!e) { failed++; continue; }
    const { error: upErr } = await sb.from("memories").update({ embedding: JSON.stringify(e) }).eq("id", m.id);
    if (upErr) failed++; else done++;
  }
  const more = (data?.length ?? 0) === BATCH;
  return Response.json({ provider: embeddingProvider(), done, failed, next: more ? offset + BATCH : null });
}
