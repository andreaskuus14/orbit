import { requireUser } from "@/lib/supabase/server";
import { createMemory, type MemoryInput } from "@/lib/memory";
import { learnFacts } from "@/lib/facts";
import { emit } from "@/lib/claude";
import { journalEntry } from "@/lib/evening-pure";

/** "Today in a minute": POST { text } → a private journal memory (the sleep loop sees it with the other memories overnight),
 *  facts from the owner's own words (learnFacts), and a ledger "journal.saved" event. Nothing here enters CORE's always-in-context blocks. */
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
      // Before migration 0017 the kind check rejects "journal": keep the entry as a note (no facts: the database won't take them from it).
      if ((err as { code?: string })?.code !== "23514") throw err;
      saved = await createMemory(sb, user.id, { ...input, kind: "note" });
    }
    const id = saved.memory.id as string;
    const facts = saved.memory.kind === "journal" ? await learnFacts(sb, user.id, e.content, id, false, "journal") : 0;
    await emit(sb, user.id, "journal.saved", "life", { memoryId: id, facts });
    return Response.json({ ok: true, id, facts });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't save today's entry" }, { status: 500 });
  }
}
