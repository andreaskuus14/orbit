import { safeMessage } from "@/lib/api-error-pure";
import { requireUser } from "@/lib/supabase/server";
import { MEMORY_COLUMNS } from "@/lib/memory-search";
import { vault, type Link, type Mem, type Project } from "@/lib/obsidian-pure";
import { zipStore } from "@/lib/zip-pure";
import { openMemory } from "@/lib/life-journal";

/** ORBIT as an Obsidian vault (.zip of linked Markdown notes). ?journal=1 includes journal entries (left out by default). */
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const all = async <T,>(table: string, cols: string): Promise<T[]> => {
    const rows: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select(cols).eq("user_id", user.id).order("created_at").range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      rows.push(...((data ?? []) as T[])); if (!data || data.length < 1000) return rows;
    }
  };
  try {
    const [memories, links, projects] = await Promise.all([all<Mem>("memories", MEMORY_COLUMNS), all<Link>("memory_links", "from_id, to_id, status, created_at"), all<Project>("projects", "id, name, description, status, created_at")]);
    const exportedAt = new Date().toISOString();
    const includeJournal = new URL(req.url).searchParams.get("journal") === "1";
    // ?journal=1 is the owner's explicit download: journal rows are opened (life-journal.ts); otherwise they are left out unread.
    const mems = includeJournal ? memories.map((m) => openMemory(m as Mem & { created_at: string }, user.id)) : memories.filter((m) => m.kind !== "journal");
    const files = vault({ memories: mems, links, projects, includeJournal, exportedAt });
    const enc = new TextEncoder(), zip = zipStore(Object.entries(files).map(([path, text]) => ({ path: `ORBIT vault/${path}`, bytes: enc.encode(text) })));
    return new Response(new Uint8Array(zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="orbit-obsidian-${exportedAt.slice(0, 10)}.zip"` } });
  } catch (e) {
    return Response.json({ error: safeMessage(e, "Export failed") }, { status: 500 });
  }
}
