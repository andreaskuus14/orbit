import { requireUser } from "@/lib/supabase/server";
import { siteFromIdea } from "@/lib/site-idea";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST {idea, lang?} → a new workspace with a full site built from one sentence (brief drafted by the model, validated, QA-ready). */
export async function POST(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => ({}));
  const idea = typeof b?.idea === "string" ? b.idea.trim().slice(0, 600) : "";
  if (idea.length < 8) return Response.json({ error: "Describe the site in a sentence (what it's for, and for whom)." }, { status: 400 });
  const r = await siteFromIdea(user.id, idea, b?.lang === "et" ? "et" : "en", req.signal);
  return "error" in r ? Response.json(r, { status: 502 }) : Response.json(r);
}
