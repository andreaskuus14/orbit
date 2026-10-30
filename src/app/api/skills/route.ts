import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { emit } from "@/lib/claude";
import { cardSkill, decideProposal, deleteSkill, editSkill, evalSkill, promoteSkill, rollbackSkill, scanSkills, skillsView } from "@/lib/skills";

export const dynamic = "force-dynamic";

// Skill forge (Agents → Skills). GET: kept skills + open proposals. POST {action}: scan | keep {id, edits?} | dismiss {id} |
// edit {id, name, instruction, tools, example} (→ candidate version) | card {id, v, owner, inputs, examples, limits} |
// eval {id, v, pass, note} | promote {id, v} | rollback {id, v} | delete {id}. Running a skill is "run skill <name>" in CORE (core-turn.ts).
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json(await skillsView()); } catch (e) { return fail(e instanceof Error ? e.message : "Skills failed", 500); }
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/skills", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  try {
    let err: string | null = null;
    if (b.action === "scan") await scanSkills(sb, user.id);
    else if (!isId(b.id)) return fail("id is required");
    else if (b.action === "keep" || b.action === "dismiss") err = await decideProposal(b.id, b.action, b.edits);
    else if (b.action === "edit") err = await editSkill(b.id, b);
    else if (b.action === "rollback") err = Number.isInteger(b.v) ? await rollbackSkill(b.id, b.v as number) : "v must be a version number";
    else if (["card", "eval", "promote"].includes(b.action as string) && !Number.isInteger(b.v)) err = "v must be a version number";
    else if (b.action === "card") err = await cardSkill(b.id, b.v as number, b);
    else if (b.action === "eval") err = typeof b.pass === "boolean" ? await evalSkill(b.id, b.v as number, b.pass, String(b.note ?? "")) : "pass must be true or false";
    else if (b.action === "promote") err = await promoteSkill(b.id, b.v as number);
    else if (b.action === "delete") err = (await deleteSkill(b.id)) ? null : "Skill not found";
    else return fail("Unknown action");
    if (err) return fail(err, 409);
    if (b.action !== "scan") void emit(sb, user.id, `skill.${b.action}`, "agents", { id: b.id as string }); // id only, never skill text
    return Response.json(await skillsView());
  } catch (e) { return fail(e instanceof Error ? e.message : "Skills failed", 500); }
}
