import { requireUser } from "@/lib/supabase/server";
import { layout } from "@/lib/memory-map-pure";
import { parseEmbedding } from "@/lib/memory-world-pure";

// MEMORY world: star positions are computed here so 1024-dim embeddings never reach the browser.
const CAP = 2000, PAGE = 500, TTL = 5 * 60_000; // PAGE stays under PostgREST's default 1000-row cap
type Row = { id: string; title: string; kind: string; tags: string[] | null; created_at: string; source: string | null; embedding: unknown };
// shortcut: per-process cache (one server on the owner's PC); a count change (add/delete) misses it, an edit waits out the TTL.
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try {
    const { count, error: ce } = await sb.from("memories").select("id", { count: "exact", head: true });
    if (ce) throw ce;
    const key = `${user.id}:${count ?? 0}`, hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return Response.json(hit.body);

    const rows: Row[] = [];
    for (let from = 0; from < Math.min(count ?? 0, CAP); from += PAGE) {
      const { data, error } = await sb.from("memories").select("id, title, kind, tags, created_at, source, embedding")
        .order("created_at", { ascending: false }).order("id").range(from, Math.min(from + PAGE, CAP) - 1);
      if (error) throw error;
      rows.push(...(data as Row[]));
      if (data.length < PAGE) break;
    }
    const ids = new Set(rows.map((r) => r.id));
    const { data: linkRows, error: le } = await sb.from("memory_links").select("from_id, to_id").neq("status", "rejected").limit(10_000);
    if (le) throw le;
    const links = (linkRows ?? []).filter((l) => ids.has(l.from_id) && ids.has(l.to_id)).map((l) => ({ from: l.from_id as string, to: l.to_id as string }));
    const pts = layout(rows.map((r) => ({ id: r.id, kind: r.kind, tags: r.tags ?? [], embedding: parseEmbedding(r.embedding) })), links);
    const r2 = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
    const items = rows.map((r, i) => ({ id: r.id, title: r.title, kind: r.kind, tags: r.tags ?? [], created_at: r.created_at, source: r.source,
      x: r2(pts[i].x), y: r2(pts[i].y), z: r2(pts[i].z) }));
    const body = { items, links, total: count ?? 0 };
    for (const [k] of cache) if (k.startsWith(`${user.id}:`)) cache.delete(k);
    cache.set(key, { at: Date.now(), body });
    return Response.json(body);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not load the memory map" }, { status: 500 });
  }
}
