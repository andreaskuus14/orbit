import { requireUser } from "@/lib/supabase/server";
import { BusyError } from "@/lib/claude";
import { usageHardHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { bookDeck, studyBooks, weeklyQuiz, deleteCard, draftFromMemory, editCard, gradeCard, saveCards, studyView } from "@/lib/study";
import { SOURCES, parseDeck, type CardSource, type Draft } from "@/lib/study-pure";

export const dynamic = "force-dynamic";

// Study cards (MEMORY → Study cards). GET → {cards, queue, stats, lessons}. POST actions:
// {action:"add", source, ref?, cards:[{front,back}]} | {action:"deck", text} | {action:"review", id, grade:1-4} | {action:"edit", id, front, back}
// | {action:"books"} → {books} | {action:"quiz"} → {quiz: ≤10 due book cards} | {action:"bookCards", book} → {added, left}
// | {action:"delete", id} | {action:"draft", memoryId} → {drafts} (one fast-model call, nothing saved).
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 300;

export async function GET() {
  const { user, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await studyView(user.id)); } catch (e) { return fail(e instanceof Error ? e.message : "Study cards failed", 500); }
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    switch (b?.action) {
      case "add": {
        if (!SOURCES.includes(b.source as CardSource) || !Array.isArray(b.cards)) return fail("source and cards are required");
        await saveCards(user.id, (b.cards as Draft[]).slice(0, 50), b.source as CardSource, typeof b.ref === "string" ? b.ref : undefined);
        break;
      }
      case "deck": {
        const cards = typeof b.text === "string" ? parseDeck(b.text.slice(0, 100_000)) : [];
        if (!cards.length) return fail("One card per line: front :: back");
        await saveCards(user.id, cards, "deck");
        break;
      }
      case "review":
        if (!isId(b.id) || ![1, 2, 3, 4].includes(b.grade as number)) return fail("id and grade (1-4) are required");
        if (!(await gradeCard(user.id, b.id, b.grade as 1 | 2 | 3 | 4))) return fail("That card is gone", 404);
        break;
      case "edit":
        if (!isId(b.id) || !(await editCard(user.id, b.id, { front: String(b.front ?? ""), back: String(b.back ?? "") }))) return fail("Card not found or a side is empty");
        break;
      case "delete":
        if (!isId(b.id)) return fail("id is required");
        await deleteCard(user.id, b.id);
        break;
      case "draft": {
        if (!isId(b.memoryId)) return fail("memoryId is required");
        const held = stopAllOn() ? "Stop-all is on" : usageHardHold();
        if (held) return fail(`Not right now: ${held}`, 503);
        const r = await draftFromMemory(sb, user.id, b.memoryId, req.signal);
        if (typeof r === "string") return fail(r, r === "Memory not found" ? 404 : 403);
        return Response.json(r);
      }
      case "books": return Response.json({ books: await studyBooks() });
      case "quiz": return Response.json({ quiz: await weeklyQuiz(user.id) });
      case "bookCards": { // ARCH study: cards from the next chapters of a VAULT book
        if (!isId(b.book)) return fail("book is required");
        const held = stopAllOn() ? "Stop-all is on" : usageHardHold();
        if (held) return fail(`Not right now: ${held}`, 503);
        const r = await bookDeck(sb, user.id, b.book, 3, req.signal);
        return typeof r === "string" ? fail(r, 404) : Response.json(r);
      }
      default: return fail("Unknown action");
    }
    return Response.json(await studyView(user.id));
  } catch (e) {
    if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
    return fail(e instanceof Error ? e.message : "Study cards failed", 500);
  }
}
