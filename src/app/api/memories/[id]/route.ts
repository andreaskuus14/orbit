import { requireUser } from "@/lib/supabase/server";
import { emit } from "@/lib/claude";
import { embed } from "@/lib/embeddings";
import { MEMORY_COLUMNS } from "@/lib/memory";
import { cleanTags, str } from "@/lib/pure";
import { isMissingColumn, PROVENANCE_COLUMNS } from "@/lib/provenance-pure";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { id } = await params;
  const one = (cols: string) => sb.from("memories").select(cols).eq("id", id).maybeSingle();
  let { data, error } = await one(`${MEMORY_COLUMNS}, ${PROVENANCE_COLUMNS}`);
  if (isMissingColumn(error)) ({ data, error } = await one(MEMORY_COLUMNS)); // until migration 0019
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  const { data: links } = await sb.from("memory_links").select("id, from_id, to_id, status, score")
    .or(`from_id.eq.${id},to_id.eq.${id}`).neq("status", "rejected");
  return Response.json({ memory: data, links: links ?? [] });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if ("title" in body) { const t = str(body.title, 300, 1); if (!t) return Response.json({ error: "Bad title" }, { status: 400 }); patch.title = t; }
  if ("content" in body) { const c = str(body.content, 200_000); if (c === null) return Response.json({ error: "Bad content" }, { status: 400 }); patch.content = c; }
  if ("tags" in body) patch.tags = cleanTags(body.tags);
  if ("folder" in body) patch.folder = str(body.folder, 100) || null;
  if (!Object.keys(patch).length) return Response.json({ error: "Nothing to update" }, { status: 400 });

  if ("title" in patch || "content" in patch) {
    const { data: cur } = await sb.from("memories").select("title, content").eq("id", id).maybeSingle();
    if (cur) {
      const e = await embed(`${patch.title ?? cur.title}\n\n${patch.content ?? cur.content}`, "document");
      patch.embedding = e ? JSON.stringify(e) : null;
    }
  }
  const { data, error } = await sb.from("memories").update(patch).eq("id", id).select(MEMORY_COLUMNS).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });
  await emit(sb, user.id, "memory.updated", "memory", { id });
  return Response.json({ memory: data });
}

export async function DELETE(_: Request, { params }: Ctx) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const { id } = await params;
  const { data, error } = await sb.from("memories").delete().eq("id", id).select("id, storage_path");
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data?.length) return Response.json({ error: "Not found" }, { status: 404 });
  if (data[0].storage_path) {
    const { error: rmErr } = await sb.storage.from("vault").remove([data[0].storage_path]);
    if (rmErr) console.error("[orbit] memory deleted but its file was not", rmErr);
  }
  await emit(sb, user.id, "memory.deleted", "memory", { id });
  return Response.json({ ok: true });
}
