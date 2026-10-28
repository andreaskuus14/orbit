import { requireUser } from "@/lib/supabase/server";
import { searchMemories } from "@/lib/memory";
import { searchVault } from "@/lib/vault";
import { exportLife } from "@/lib/life";
import { journalHits, likePattern, rankHits, snip, vaultSource, type SearchHit, type SearchSource } from "@/lib/search-pure";

export const dynamic = "force-dynamic";

// GET ?q= → { results: RankedHit[], failed: SearchSource[] }. Read-only "search everything" for the Warp palette (lib/search-pure.ts).
// Journal (memory kind "journal" and the local LIFE journal) is included because this is the owner's own screen; the
// results go only to his browser, never into a model prompt. One failing source never fails the others.
const PER = 10;

export async function GET(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 200) ?? "";
  const like = likePattern(q);
  if (!like) return Response.json({ results: [], failed: [] });

  type Row = Record<string, unknown>;
  const rows = async (p: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return (data ?? []) as Row[];
  };
  const s = (v: unknown) => (typeof v === "string" ? v : "");

  const sources: [SearchSource[], () => Promise<SearchHit[]>][] = [
    [["memory", "journal"], async () => (await searchMemories(sb, q, PER, undefined, { includeJournal: true })).results.map((m: Row): SearchHit => ({
      source: m.kind === "journal" ? "journal" : "memory", id: s(m.id), title: s(m.title) || "(untitled)", snippet: snip(s(m.content), q), at: s(m.updated_at) || s(m.created_at), open: { memory: s(m.id) },
    }))],
    [["journal"], async () => journalHits((await exportLife()).journal, q)],
    [["note", "file"], async () => (await searchVault(q, PER)).map((f): SearchHit => ({
      source: vaultSource(f.name), id: f.name, title: f.name, snippet: f.snippet, open: { nav: { panel: "vault" } },
    }))],
    [["chat"], async () => {
      // Title hits first, then chats whose messages mention it (newest message per chat).
      const [titled, said] = await Promise.all([
        rows(sb.from("conversations").select("id, title, updated_at").ilike("title", like).order("updated_at", { ascending: false }).limit(PER)),
        rows(sb.from("messages").select("conversation_id, content, created_at").ilike("content", like).order("created_at", { ascending: false }).limit(40)),
      ]);
      const out: SearchHit[] = titled.map((c) => ({ source: "chat", id: s(c.id), title: s(c.title) || "Chat", snippet: "", at: s(c.updated_at), open: { chat: s(c.id) } }));
      const missing = [...new Set(said.map((m) => s(m.conversation_id)))].filter((id) => !out.some((h) => h.id === id)).slice(0, PER);
      const names = missing.length ? new Map((await rows(sb.from("conversations").select("id, title").in("id", missing))).map((c) => [s(c.id), s(c.title)])) : new Map<string, string>();
      for (const id of missing) {
        const m = said.find((x) => s(x.conversation_id) === id)!;
        out.push({ source: "chat", id, title: names.get(id) || "Chat", snippet: snip(s(m.content), q), at: s(m.created_at), open: { chat: id } });
      }
      for (const h of out) if (!h.snippet) h.snippet = snip(s(said.find((m) => s(m.conversation_id) === h.id)?.content), q);
      return out;
    }],
    [["task"], async () => {
      const [a, b] = await Promise.all(["title", "request"].map((col) =>
        rows(sb.from("tasks").select("id, title, request, status, created_at").is("parent_id", null).ilike(col, like).order("created_at", { ascending: false }).limit(PER))));
      return [...new Map([...a, ...b].map((t) => [s(t.id), t])).values()].map((t): SearchHit => ({
        source: "task", id: s(t.id), title: s(t.title), snippet: `${s(t.status)} · ${snip(s(t.request), q, 110)}`, at: s(t.created_at), open: { task: s(t.id) },
      }));
    }],
    [["goal"], async () => (await rows(sb.from("goals").select("id, title, status, updated_at, why:doc->>why").ilike("title", like).order("updated_at", { ascending: false }).limit(PER)))
      .map((g): SearchHit => ({ source: "goal", id: s(g.id), title: s(g.title), snippet: [s(g.status), snip(s(g.why), q, 110)].filter(Boolean).join(" · "), at: s(g.updated_at), open: { goal: s(g.id) } }))],
  ];

  const settled = await Promise.allSettled(sources.map(([, run]) => run()));
  const failed = settled.flatMap((r, i) => (r.status === "rejected" ? (console.warn("[search]", sources[i][0][0], r.reason), sources[i][0]) : []));
  const lists = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  return Response.json({ results: rankHits(lists, q, Date.now()), failed: [...new Set(failed)] });
}
