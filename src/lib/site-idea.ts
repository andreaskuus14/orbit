// Website from one sentence, disk side: draft the brief with the model, validate (one repair round), create a workspace and build
// the site with the chosen direction. Rules and prompts: site-idea-pure.ts.
import { askClaude } from "./claude";
import { buildSite } from "./site-brief";
import { parseBrief } from "./site-brief-pure";
import { createWorkspace, previewUrl } from "./workspace";
import { firstJson, IDEA_SYSTEM, ideaPrompt, pickDirection, placeholders, repairPrompt, siteSlugName } from "./site-idea-pure";

export type IdeaSite = { slug: string; preview: string; direction: string; name: string; fill: string[] } | { error: string };
export async function siteFromIdea(uid: string, idea: string, lang: "en" | "et" = "en", signal?: AbortSignal): Promise<IdeaSite> {
  const direction = pickDirection(idea);
  let draft = firstJson((await askClaude(ideaPrompt(idea, lang), IDEA_SYSTEM, { purpose: "site from idea", signal })).text);
  let parsed = draft ? parseBrief({ ...(draft as object), style: direction }) : { errors: ["the reply was not JSON"] };
  if ("errors" in parsed) {
    draft = firstJson((await askClaude(repairPrompt(idea, lang, parsed.errors), IDEA_SYSTEM, { purpose: "site from idea (repair)", signal })).text);
    parsed = draft ? parseBrief({ ...(draft as object), style: direction }) : { errors: ["the reply was not JSON"] };
  }
  if ("errors" in parsed) return { error: `Couldn't write a valid brief: ${parsed.errors.slice(0, 3).join("; ")}` };
  const ws = await createWorkspace(uid, siteSlugName(parsed.brief.name));
  if ("error" in ws) return ws;
  const built = await buildSite(uid, ws.slug, { ...(draft as object), style: direction });
  if ("errors" in built) return { error: built.errors.slice(0, 3).join("; ") };
  return { slug: ws.slug, preview: await previewUrl(uid, ws.slug), direction, name: built.brief.name, fill: placeholders(draft) };
}
