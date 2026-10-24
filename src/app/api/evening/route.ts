import { requireUser } from "@/lib/supabase/server";
import { createMemory, type MemoryInput } from "@/lib/memory";
import { emit } from "@/lib/claude";
import { journalEntry } from "@/lib/evening-pure";

/** "Today in a minute": POST { text } → a private journal memory (the sleep loop sees it with the other memories overnight)
 *  and a ledger "journal.saved" event. LIFE data: no beliefs are learned from it (they're always in CORE's context), and
 *  CORE/agent memory search skips kind journal (memory-search.ts). */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const e = journalEntry(b?.text, new Date());
  if ("error" in e) return Response.json({ error: e.error }, { status: 400 });
  const input: MemoryInput = { kind: "journal", title: e.title, content: e.content, source: "evening", tags: ["journal"] };
  try {
    let saved;
    try { saved = await createMemory(sb, user.id, input); }
    catch (err) {
      if ((err as { code?: string })?.code !== "23514") throw err;
      // Before migration 0017 the kind check rejects "journal". Don't lose the entry, but don't save it as a note CORE could search either.
      return Response.json({ error: "Journal isn't set up yet: run supabase/migrations/0017_journal.sql in Supabase. Your text is still here." }, { status: 503 });
    }
    const id = saved.memory.id as string;
    await emit(sb, user.id, "journal.saved", "life", { memoryId: id });
    return Response.json({ ok: true, id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't save today's entry" }, { status: 500 });
  }
}
