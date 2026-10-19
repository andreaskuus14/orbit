import { KICK, parseKick, type ReachItem } from "./pure";
import { Blocked, getJson, hintFor } from "./net";

/** Today's clips per Kick channel from kick.com's own JSON. Cloudflare blocking us is reported, never worked around. */
export async function readKick(slugs: string[]): Promise<{ items: ReachItem[]; hints: string[] }> {
  const items: ReachItem[] = [], hints: string[] = [];
  for (const slug of slugs) {
    try { items.push(...parseKick(await getJson(KICK.clips(slug.toLowerCase())))); }
    catch (e) {
      if (e instanceof Blocked && (e.status === 403 || e.status === 429)) { hints.push("Kick is blocking anonymous requests right now (Cloudflare); check kick.com in your browser"); break; }
      hints.push(hintFor(`Kick ${slug}`, e));
    }
  }
  return { items, hints };
}
