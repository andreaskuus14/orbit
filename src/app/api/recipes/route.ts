import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { getAgent } from "@/lib/agents";
import { addRecipe, deleteRecipe, listRecipes } from "@/lib/recipes";
import { validateRecipe } from "@/lib/recipes-pure";

export const dynamic = "force-dynamic";

// Agent recipes. GET: the list. POST {action:"add", name, agent, request} | {action:"delete", id}.
// Running one is a normal POST /api/tasks with its agent + request (the client does that), so no new execution path.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ recipes: await listRecipes() });
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/recipes", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  if (b.action === "delete") return typeof b.id === "string" && (await deleteRecipe(b.id)) ? Response.json({ recipes: await listRecipes() }) : fail("Not found", 404);
  if (b.action !== "add") return fail("action must be add or delete");
  const r = validateRecipe(b);
  if (typeof r === "string") return fail(r);
  if (!(await getAgent(sb, r.agent))) return fail(`Unknown agent "${r.agent}"`);
  const saved = await addRecipe(r);
  return typeof saved === "string" ? fail(saved, 409) : Response.json({ recipe: saved, recipes: await listRecipes() }, { status: 201 });
}
