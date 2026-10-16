import { requireUser } from "@/lib/supabase/server";
import { BusyError } from "@/lib/claude";
import { brainstorm, changeStyle, getBoard, pickBest, removeBoardItem, saveToBoard, searchStyled, setStyleSummary } from "@/lib/refs";
import { cleanQuery, cleanText, validateItem, MAX_SUMMARY } from "@/lib/refs-pure";

export const dynamic = "force-dynamic";

// GAME DEV reference board. GET ?q=word → { query, sections } (Creator Store, Openverse, Reddit; cached 30 min).
// &style=1 applies the locked style's keywords. GET (no q) → { board, style }.
// POST { action: pick|ideas, q, styled? } → { picks } | { ideas }; { action: save, item, word } | { action: remove, id, word } → { board };
// { action: style-add, item } | { action: style-remove, id } → { style, error? }; { action: style-summary, summary } → { style }.

const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const raw = new URL(req.url).searchParams.get("q");
  if (raw === null) return Response.json(await getBoard());
  const q = cleanQuery(raw);
  return q ? Response.json(await searchStyled(q, new URL(req.url).searchParams.get("style") === "1")) : bad("Type a word of 1–60 characters");
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
        return Response.json(b.action === "pick" ? { picks: await pickBest(q, b.styled === true) } : { ideas: await brainstorm(q) });
      }
      case "save": {
        const item = validateItem(b.item), word = cleanQuery(b.word);
        return item && word ? Response.json({ board: await saveToBoard(item, word) }) : bad("Invalid item or word");
      }
      case "remove": {
        const word = cleanQuery(b.word);
        return typeof b.id === "string" && b.id.length <= 80 && word ? Response.json({ board: await removeBoardItem(b.id, word) }) : bad("Missing id or word");
      }
      case "style-add": {
        const item = validateItem(b.item);
        return item ? Response.json(await changeStyle({ add: item })) : bad("Invalid item");
      }
      case "style-remove":
        return typeof b.id === "string" && b.id.length <= 80 ? Response.json(await changeStyle({ remove: b.id })) : bad("Missing id");
      case "style-summary":
        return typeof b.summary === "string" ? Response.json({ style: await setStyleSummary(cleanText(b.summary, MAX_SUMMARY)) }) : bad("Missing summary");
      default:
        return bad("Unknown action");
    }
  } catch (e) {
    if (e instanceof BusyError) return bad("ORBIT is busy with other AI work — try again in a moment.", 503);
    console.error("[orbit] refs", e); // details (paths, CLI output) stay in the server log
    return bad("Something went wrong — try again.", 500);
  }
}
