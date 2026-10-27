// Memory controls (provenance-pure.ts): POST {action: "why" | "confirm" | "correct" | "forget", content?}.
// why: the source chain. confirm ("Remember this"): mark confirmed. correct: new text, re-embed, and rewrite summaries
// that quote the old text. forget: delete, and strip it from summaries that quote it. Owner's own click only.
import { requireUser } from "@/lib/supabase/server";
import { emit } from "@/lib/claude";
import { embed } from "@/lib/embeddings";
import { str } from "@/lib/pure";
import { correctionPlan, forgetPlan, isMissingColumn, PROVENANCE_COLUMNS, rewriteDerived, whySources, type MemRecord } from "@/lib/provenance-pure";
import type { SupabaseClient } from "@supabase/supabase-js";

type Ctx = { params: Promise<{ id: string }> };
const LITE = "id, kind, title, content, source, created_at, tags";

async function rows(sb: SupabaseClient, q: (cols: string) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>) {
  let r = await q(`${LITE}, source_ref, confirmation, recheck_at`);
  if (isMissingColumn(r.error)) r = await q(LITE); // until migration 0019
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []) as MemRecord[];
}

/** Summaries built from this memory: tagged with its id, or citing it as source_ref (after 0019). */
async function derived(sb: SupabaseClient, id: string) {
  const all = await rows(sb, (cols) => sb.from("memories").select(cols).contains("tags", [id]).neq("kind", "journal").limit(50));
  const byRef = await rows(sb, (cols) => sb.from("memories").select(cols).eq("source_ref", id).neq("kind", "journal").limit(50)).catch(() => []);
  return [...new Map([...all, ...byRef].map((r) => [r.id, r])).values()];
}

async function rewrite(sb: SupabaseClient, targets: MemRecord[], ids: string[], oldText: string, newText: string) {
  let n = 0;
  for (const r of targets.filter((t) => ids.includes(t.id))) {
    const content = rewriteDerived(r.content, oldText, newText);
    if (content === null) continue;
    const e = await embed(`${r.title}\n\n${content}`, "document");
    const { error } = await sb.from("memories").update({ content, embedding: e ? JSON.stringify(e) : null }).eq("id", r.id);
    if (!error) n++;
  }
  return n;
}

export async function POST(req: Request, { params }: Ctx) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const [cur] = await rows(sb, (cols) => sb.from("memories").select(cols).eq("id", id).limit(1));
    if (!cur) return Response.json({ error: "Not found" }, { status: 404 });

    if (body.action === "why") {
      const chain = [cur];
      for (let ref = cur.source_ref, i = 0; ref && i < 5 && !chain.some((c) => c.id === ref); i++) {
        const [r] = await rows(sb, (cols) => sb.from("memories").select(cols).eq("id", ref!).limit(1)).catch(() => []);
        if (!r) break;
        chain.push(r); ref = r.source_ref;
      }
      const links = await sb.from("memory_links").select("from_id, to_id").or(`from_id.eq.${id},to_id.eq.${id}`).eq("status", "confirmed");
      return Response.json({ sources: whySources([id], chain), linked: (links.data ?? []).map((l) => (l.from_id === id ? l.to_id : l.from_id)) });
    }

    if (body.action === "confirm") {
      const { error } = await sb.from("memories").update({ confirmation: "confirmed" }).eq("id", id);
      if (isMissingColumn(error)) return Response.json({ error: "Run migration 0019 first" }, { status: 409 });
      if (error) throw new Error(error.message);
      await emit(sb, user.id, "memory.updated", "memory", { id });
      return Response.json({ ok: true });
    }

    const kids = await derived(sb, id);
    if (body.action === "correct") {
      const content = str(body.content, 200_000, 1);
      if (!content) return Response.json({ error: "Bad content" }, { status: 400 });
      const plan = correctionPlan(id, content, kids);
      const e = await embed(`${cur.title}\n\n${plan.patch.content}`, "document");
      const patch: Record<string, unknown> = { ...plan.patch, embedding: e ? JSON.stringify(e) : null };
      let { error } = await sb.from("memories").update(patch).eq("id", id);
      if (isMissingColumn(error)) { delete patch.confirmation; ({ error } = await sb.from("memories").update(patch).eq("id", id)); }
      if (error) throw new Error(error.message);
      const updated = await rewrite(sb, kids, plan.rebuild, cur.content, plan.patch.content);
      await emit(sb, user.id, "memory.updated", "memory", { id });
      return Response.json({ ok: true, summariesUpdated: updated });
    }

    if (body.action === "forget") {
      const plan = forgetPlan(id, kids);
      const updated = await rewrite(sb, kids, plan.rebuild, cur.content, "");
      const { data, error } = await sb.from("memories").delete().eq("id", id).select("storage_path");
      if (error) throw new Error(error.message);
      if (data?.[0]?.storage_path) await sb.storage.from("vault").remove([data[0].storage_path]).catch(() => null);
      await emit(sb, user.id, "memory.deleted", "memory", plan.audit); // audit keeps the id only, never the text
      return Response.json({ ok: true, summariesUpdated: updated });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}

