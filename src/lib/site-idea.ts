// Website from one sentence, disk side: draft the brief with the model, validate (one repair round), create a workspace and build
// the site with the chosen direction. Rules and prompts: site-idea-pure.ts.
import { askClaude } from "./claude";
import { withoutStats } from "./lead-loop-pure";
import { buildSite } from "./site-brief";
import { parseBrief } from "./site-brief-pure";
import { createWorkspace, previewUrl } from "./workspace";
import { assumptions, firstJson, HONEST_IDEA_SYSTEM, IDEA_SYSTEM, ideaPrompt, pickDirection, placeholders, repairPrompt, siteSlugName } from "./site-idea-pure";

export type IdeaSite = { slug: string; preview: string; direction: string; name: string; fill: string[]; assumed: string[] } | { error: string };
/** honest: the lead-loop demo variant (no stat labels; see HONEST_IDEA_SYSTEM). */
export async function siteFromIdea(uid: string, idea: string, lang: "en" | "et" = "en", signal?: AbortSignal, honest = false): Promise<IdeaSite> {
  const direction = pickDirection(idea), system = honest ? HONEST_IDEA_SYSTEM : IDEA_SYSTEM;
  const strip = (d: unknown) => (honest && d ? withoutStats(d) : d);
  let draft = strip(firstJson((await askClaude(ideaPrompt(idea, lang), system, { purpose: "site from idea", signal })).text));
  let parsed = draft ? parseBrief({ ...(draft as object), style: direction }) : { errors: ["the reply was not JSON"] };
  if ("errors" in parsed) {
    draft = strip(firstJson((await askClaude(repairPrompt(idea, lang, parsed.errors), system, { purpose: "site from idea (repair)", signal })).text));
    parsed = draft ? parseBrief({ ...(draft as object), style: direction }) : { errors: ["the reply was not JSON"] };
  }
  if ("errors" in parsed) return { error: `Couldn't write a valid brief: ${parsed.errors.slice(0, 3).join("; ")}` };
  const ws = await createWorkspace(uid, siteSlugName(parsed.brief.name));
  if ("error" in ws) return ws;
  const built = await buildSite(uid, ws.slug, { ...(draft as object), style: direction });
  if ("errors" in built) return { error: built.errors.slice(0, 3).join("; ") };
  return { slug: ws.slug, preview: await previewUrl(uid, ws.slug), direction, name: built.brief.name, fill: placeholders(draft), assumed: assumptions(draft) };
}
