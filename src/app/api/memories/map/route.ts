import { requireUser } from "@/lib/supabase/server";
import { layout } from "@/lib/memory-map-pure";
import { parseEmbedding, stabilize } from "@/lib/memory-world-pure";
import { similarEdges } from "@/lib/memory-edges-pure";
import { cleanTagList, isoOrNull } from "@/lib/memory-planet-pure";
import { mapCacheGet, mapCacheSet } from "@/lib/memory-map-cache";

// MEMORY world: star positions are computed here so 1024-dim embeddings never reach the browser.
const CAP = 2000, PAGE = 500; // PAGE stays under PostgREST's default 1000-row cap
type Row = { id: string; title: string; kind: string; tags: string[] | null; folder: string | null; created_at: string; source: string | null; embedding: unknown };
// Cache: lib/memory-map-cache.ts (per process; a count change misses it, an edit drops it).
// MEM06: last positions per user so stars stay put between refreshes. shortcut: per-process, lost on restart; persist if that matters.
const placed = new Map<string, Map<string, [number, number, number]>>();

export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try {
    const { count, error: ce } = await sb.from("memories").select("id", { count: "exact", head: true });
    if (ce) throw ce;
    const hit = mapCacheGet(user.id, count ?? 0);
    if (hit) return Response.json(hit);

    const rows: Row[] = [];
    for (let from = 0; from < Math.min(count ?? 0, CAP); from += PAGE) {
      const { data, error } = await sb.from("memories").select("id, title, kind, tags, folder, created_at, source, embedding")
        .order("created_at", { ascending: false }).order("id").range(from, Math.min(from + PAGE, CAP) - 1);
      if (error) throw error;
      rows.push(...(data as Row[]));
      if (data.length < PAGE) break;
    }
    const ids = new Set(rows.map((r) => r.id));
    const { data: linkRows, error: le } = await sb.from("memory_links").select("from_id, to_id").neq("status", "rejected").limit(10_000);
    if (le) throw le;
    const links = (linkRows ?? []).filter((l) => ids.has(l.from_id) && ids.has(l.to_id)).map((l) => ({ from: l.from_id as string, to: l.to_id as string }));
    const vecs = rows.map((r) => parseEmbedding(r.embedding));
    const pts = stabilize(placed.get(user.id), layout(rows.map((r, i) => ({ id: r.id, kind: r.kind || "note", tags: cleanTagList(r.tags), embedding: vecs[i] })), links));
    const edges = similarEdges(vecs); // [a, b, sim] as item indexes: the similarity web, aged client-side
    const r2 = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
    // journal rows are encrypted: only "Journal entry", no tags or folder. Every field is cleaned (a NULL in tags[] crashed the planet).
    const items = rows.map((r, i) => { const j = r.kind === "journal"; return { id: r.id, title: j ? "Journal entry" : (r.title || "Untitled"), kind: r.kind || "note",
      tags: j ? [] : cleanTagList(r.tags), folder: j ? null : r.folder, created_at: isoOrNull(r.created_at), source: r.source,
      x: r2(pts[i].x), y: r2(pts[i].y), z: r2(pts[i].z) }; });
    const graph = await import("@/lib/memory-graph").then((m) => m.getGraph(sb, user.id)).catch(() => null); // cluster halos + list; best-effort
    placed.set(user.id, new Map(items.map((m) => [m.id, [m.x, m.y, m.z] as [number, number, number]])));
    const body = { items, links, edges, total: count ?? 0, graph };
    mapCacheSet(user.id, count ?? 0, body);
    return Response.json(body);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not load the memory map" }, { status: 500 });
  }
}
