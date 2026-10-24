import { requireUser } from "@/lib/supabase/server";
import { createMemory, searchMemories, fetchPage, KINDS, MEMORY_COLUMNS, type Kind } from "@/lib/memory";
import { cleanTags, str } from "@/lib/pure";

export async function GET(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams.get("q")?.trim();
  try {
    if (q) return Response.json(await searchMemories(sb, q.slice(0, 500), 30, undefined, { includeJournal: true }));
    const { data, error } = await sb.from("memories").select(MEMORY_COLUMNS).order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return Response.json({ results: data, mode: "list" });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Search failed" }, { status: 500 });
  }
}

/** Universal capture: a note/idea/etc., or a link (fetched and stored as readable text). */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid JSON" }, { status: 400 });

  const kind = (KINDS as readonly string[]).includes(body.kind) ? (body.kind as Kind) : "note";
  let title = str(body.title, 300);
  let content = str(body.content, 200_000);
  const url = str(body.url, 2000);
  if (title === null || content === null || url === null) return Response.json({ error: "Invalid field" }, { status: 400 });

  try {
    let source = "capture";
    if (url) {
      let parsed: URL;
      try { parsed = new URL(url); } catch { return Response.json({ error: "Invalid URL" }, { status: 400 }); }
      const page = await fetchPage(parsed.toString());
      title ||= page.title;
      content = content ? `${content}\n\n---\n${page.text}` : page.text;
      source = "url";
    }
    if (!title) title = content.split("\n")[0].slice(0, 80);
    if (!title) return Response.json({ error: "Add a title or some content" }, { status: 400 });

    const out = await createMemory(sb, user.id, {
      kind: url ? "link" : kind, title: title.slice(0, 300), content, source, url: url || null,
      tags: cleanTags(body.tags), folder: str(body.folder, 100) || null,
    });
    return Response.json(out, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not save" }, { status: 502 });
  }
}
