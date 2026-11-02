import { requireUser } from "@/lib/supabase/server";
import { decideLesson, lessonsView, mineLessons } from "@/lib/lessons";
import { emit } from "@/lib/claude";

const fail = (e: unknown) => Response.json({ error: e instanceof Error ? e.message : "Lessons failed" }, { status: 500 });

/** "What I learned about you": proposed lessons, kept ones, how many were rejected, when ORBIT last looked. */
export async function GET() {
  const { user, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await lessonsView(user.id)); } catch (e) { return fail(e); }
}

/** {id, decision:"keep"|"reject"} → Keep / Not true (reject on a kept lesson = forget it). {action:"mine"} → look again now (no model call). */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { id?: unknown; decision?: unknown; action?: unknown } | null;
  try {
    if (b?.action === "mine") await mineLessons(sb, user.id);
    else {
      if (typeof b?.id !== "string" || b.id.length > 300 || (b.decision !== "keep" && b.decision !== "reject")) return Response.json({ error: "id and decision (keep|reject) are required" }, { status: 400 });
      const err = b.id.startsWith("persona|") ? await import("@/lib/persona").then((m) => m.decideProposal(user.id, b.decision === "keep")) : await decideLesson(user.id, b.id, b.decision, sb); // a kept correction also becomes evals/corrections/<id>.json
      if (err) return Response.json({ error: err }, { status: 409 });
      void emit(sb, user.id, b.decision === "keep" ? "lesson.kept" : "lesson.rejected", "core", { id: b.id.slice(0, 128) }); // the lesson id only, never its text
    }
    return Response.json(await lessonsView(user.id));
  } catch (e) { return fail(e); }
}
