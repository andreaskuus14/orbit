import { requireUser } from "@/lib/supabase/server";
import { BusyError } from "@/lib/claude";
import { brainstorm, getBoard, pickBest, removeBoardItem, saveToBoard, searchRefs } from "@/lib/refs";
import { cleanQuery, validateItem } from "@/lib/refs-pure";

export const dynamic = "force-dynamic";

// GAME DEV reference board. GET ?q=word → { query, sections } (Creator Store, Openverse, Reddit; cached 30 min).
// GET (no q) → { board }. POST { action: pick|ideas, q } → { picks } | { ideas }; { action: save, item, word } | { action: remove, id, word } → { board }.

const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const raw = new URL(req.url).searchParams.get("q");
  if (raw === null) return Response.json({ board: await getBoard() });
  const q = cleanQuery(raw);
  return q ? Response.json(await searchRefs(q)) : bad("Type a word of 1–60 characters");
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Invalid JSON body");
  try {
    switch (b.action) {
      case "pick": case "ideas": {
        const q = cleanQuery(b.q);
        if (!q) return bad("Type a word of 1–60 characters");
        return Response.json(b.action === "pick" ? { picks: await pickBest(q) } : { ideas: await brainstorm(q) });
      }
      case "save": {
        const item = validateItem(b.item), word = cleanQuery(b.word);
        return item && word ? Response.json({ board: await saveToBoard(item, word) }) : bad("Invalid item or word");
      }
      case "remove": {
        const word = cleanQuery(b.word);
        return typeof b.id === "string" && b.id.length <= 80 && word ? Response.json({ board: await removeBoardItem(b.id, word) }) : bad("Missing id or word");
      }
      default:
        return bad("Unknown action");
    }
  } catch (e) {
    if (e instanceof BusyError) return bad("ORBIT is busy with other AI work — try again in a moment.", 503);
    console.error("[orbit] refs", e); // details (paths, CLI output) stay in the server log
    return bad("Something went wrong — try again.", 500);
  }
}
