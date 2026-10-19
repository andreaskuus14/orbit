import { REDDIT, parseReddit, type ReachItem } from "./pure";
import { getJson, hintFor } from "./net";

/** Hot + today's top for each subreddit (anonymous public JSON). */
export async function readReddit(subs: string[]): Promise<{ items: ReachItem[]; hints: string[] }> {
  const items: ReachItem[] = [], hints: string[] = [];
  for (const sub of subs) {
    for (const url of [REDDIT.hot(sub), REDDIT.top(sub)]) {
      try { items.push(...parseReddit(await getJson(url))); }
      catch (e) { hints.push(hintFor(`Reddit r/${sub}`, e)); break; } // one failure per sub is enough to report
    }
  }
  return { items, hints };
}
