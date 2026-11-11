// Reads the agent team's handoff board (a Notion page) for Mission Control. Server only: the token never reaches the browser,
// and the request carries only the page id. Needs ORBIT_NOTION_TOKEN (an internal integration the page is shared with) and
// ORBIT_TEAM_BOARD (the page URL or id). Anything missing or failing returns the reason, and the view shows the sample.
import type { Block } from "./team-status-pure";

export type BoardRead = { live: true; at: string; blocks: Block[] } | { live: false; reason: string };
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const API = "https://api.notion.com/v1";
const TTL = 60_000, MAX_REQUESTS = 25, DEPTH = 2;
const g = globalThis as { __orbitTeamBoard?: { at: number; key: string; v: BoardRead } };

/** The 32-hex page id from a Notion URL or a bare id (with or without dashes). */
export function pageId(s: string): string | null {
  const hex = s.replace(/-/g, "").match(/[0-9a-f]{32}(?![0-9a-f])/i)?.[0]; // the last 32 of a run, so "Feed-411c…" doesn't shift it
  return hex ? hex.toLowerCase() : null;
}

type NotionBlock = { id: string; type: string; has_children?: boolean } & Record<string, { rich_text?: { plain_text?: string; href?: string | null }[] } | unknown>;

export async function readBoard(env: Record<string, string | undefined> = process.env, fetcher: Fetch = fetch, now = Date.now()): Promise<BoardRead> {
  const token = env.ORBIT_NOTION_TOKEN?.trim(), page = pageId(env.ORBIT_TEAM_BOARD?.trim() ?? "");
  if (!token || !page) return { live: false, reason: "not connected: set ORBIT_NOTION_TOKEN and ORBIT_TEAM_BOARD in .env.local" };
  const key = `${page}:${token.length}`;
  if (g.__orbitTeamBoard && g.__orbitTeamBoard.key === key && now - g.__orbitTeamBoard.at < TTL) return g.__orbitTeamBoard.v;
  let requests = 0;
  const children = async (id: string, depth: number): Promise<Block[]> => {
    const out: Block[] = [];
    let cursor: string | undefined;
    do {
      if (++requests > MAX_REQUESTS) throw new Error("the board is too long to read in one go");
      const r = await fetcher(`${API}/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`, {
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" }, signal: AbortSignal.timeout(8000), cache: "no-store",
      });
      if (!r.ok) throw new Error(`Notion answered ${r.status}${r.status === 401 || r.status === 403 ? " (check the token)" : r.status === 404 ? " (share the page with the integration)" : ""}`);
      const j = (await r.json()) as { results?: NotionBlock[]; has_more?: boolean; next_cursor?: string | null };
      for (const b of j.results ?? []) {
        const rt = (b[b.type] as { rich_text?: { plain_text?: string; href?: string | null }[] } | undefined)?.rich_text;
        if (rt) out.push({ text: rt.map((t) => t.plain_text ?? "").join(""), links: rt.flatMap((t) => (t.href ? [t.href] : [])) });
        if (b.has_children && depth < DEPTH) out.push(...(await children(b.id, depth + 1))); // nested bullets continue the entry above
      }
      cursor = j.has_more && j.next_cursor ? j.next_cursor : undefined;
    } while (cursor);
    return out;
  };
  let v: BoardRead;
  try { v = { live: true, at: new Date(now).toISOString(), blocks: await children(page, 0) }; }
  catch (e) { v = { live: false, reason: `the board couldn't be read: ${(e as Error)?.name === "TimeoutError" ? "timed out" : (e as Error)?.message ?? String(e)}` }; }
  g.__orbitTeamBoard = { at: now, key, v };
  return v;
}

/** Forget the cached read (Refresh). */
export const forgetBoard = () => { g.__orbitTeamBoard = undefined; };
