import { requireUser } from "@/lib/supabase/server";
import { decideIdea, ideasView } from "@/lib/dream-ideas";
import { ideaGoal } from "@/lib/dream-ideas-pure";
import { createGoal } from "@/lib/goals";

const fail = (e: unknown) => Response.json({ error: e instanceof Error ? e.message : "Dreams failed" }, { status: 500 });
const view = async (id: string) => ({ ideas: (await ideasView(id)).ideas.filter((i) => i.status !== "discarded") });

/** DREAMS: last nights' idea combinations (dream-ideas.ts). */
export async function GET() {
  const { user, res } = await requireUser();
  if (res) return res;
  try { return Response.json(await view(user.id)); } catch (e) { return fail(e); }
}

/** {id, decision:"keep"|"discard"|"goal"}. "goal" makes a draft goal (nothing runs until he approves its plan). */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { id?: unknown; decision?: unknown } | null;
  if (typeof b?.id !== "string" || b.id.length > 100 || !["keep", "discard", "goal"].includes(String(b.decision))) return Response.json({ error: "id and decision (keep|discard|goal) are required" }, { status: 400 });
  const d = b.decision as "keep" | "discard" | "goal";
  try {
    if (d === "goal") {
      const i = (await ideasView(user.id)).ideas.find((x) => x.id === b.id);
      if (!i || i.status === "goal") return Response.json({ error: i ? "Already a goal" : "That idea is gone" }, { status: 409 });
      const g = await createGoal(sb, user.id, ideaGoal(i));
      if ("error" in g) return Response.json({ error: g.error }, { status: 409 });
    }
    const r = await decideIdea(user.id, b.id, d);
    if (typeof r === "string") return Response.json({ error: r }, { status: 409 });
    return Response.json(await view(user.id));
  } catch (e) { return fail(e); }
}
