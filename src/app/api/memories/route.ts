import { requireUser } from "@/lib/supabase/server";
import { captureMemory, searchMemories, fetchPage, KINDS, MEMORY_COLUMNS, type Kind } from "@/lib/memory";
import { cleanTags, str } from "@/lib/pure";
import { readVaultText } from "@/lib/vault";

const CHOICES = ["keep", "merge", "update"] as const;

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

/** Universal capture: a note/idea/etc., a link (fetched and stored as readable text), or a VAULT file by name (referenced,
 *  not re-uploaded). A repeat answers 409 {duplicate, preview} until the body carries onDuplicate: keep | merge | update. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid JSON" }, { status: 400 });

  const kind = (KINDS as readonly string[]).includes(body.kind) ? (body.kind as Kind) : "note";
  let title = str(body.title, 300);
  let content = str(body.content, 200_000);
  const url = str(body.url, 2000);
  const vault = str(body.vault, 255);
  const onDuplicate = CHOICES.find((c) => c === body.onDuplicate) ?? null;
  if (title === null || content === null || url === null || vault === null) return Response.json({ error: "Invalid field" }, { status: 400 });

  try {
    let source = "capture";
    if (url) {
      let parsed: URL;
      try { parsed = new URL(url); } catch { return Response.json({ error: "Invalid URL" }, { status: 400 }); }
      const page = await fetchPage(parsed.toString());
      title ||= page.title;
      content = content ? `${content}\n\n---\n${page.text}` : page.text;
      source = "url";
    } else if (vault) {
      const text = await readVaultText(vault, 200_000);
      if (text === null) return Response.json({ error: "That VAULT file has no readable text" }, { status: 404 });
      title ||= vault;
      content = content ? `${content}\n\n---\n${text}` : text;
      source = "vault";
    }
    if (!title) title = content.split("\n")[0].slice(0, 80);
    if (!title) return Response.json({ error: "Add a title or some content" }, { status: 400 });

    const out = await captureMemory(sb, user.id, {
      kind: url ? "link" : vault ? "document" : kind, title: title.slice(0, 300), content, source, url: url || null,
      tags: cleanTags(body.tags), folder: str(body.folder, 100) || null,
    }, { vault: vault || null, onDuplicate });
    return Response.json(out, { status: "preview" in out ? 409 : 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not save" }, { status: 502 });
  }
}
