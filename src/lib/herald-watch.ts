import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { getTrends, nicheViral } from "./devtools";
import { trendCards, viralCards } from "./herald-pure";
import { mergeInbox, parseInbox } from "./herald-watch-pure";
import { reachFresh } from "./reach";
import { reachCards } from "./reach/pure";
import { stopAllOn } from "./stop-all";

// Herald watch: every 3 h (first ~2 min after start) the server scans the niche (nicheViral: six-hour cached searches, cheap watched uploads; its own shared-budget allocation)
// and trends, runs the Reach scan (src/lib/reach), and appends quiet cards to <data dir>/herald-inbox.json for the bell via Herald.tsx (GET /api/herald).
// Never starts a clip job: the owner presses "Clip it now" in ORBIT.

const file = () => path.join(orbitDataDir(), "herald-inbox.json");
type St = { timer?: NodeJS.Timeout; tickFn?: unknown; running?: boolean };
const g = globalThis as unknown as { __orbitHeraldWatch?: St }; // survives dev hot reloads: one timer
const S = (g.__orbitHeraldWatch ??= {});
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function readInbox(now = Date.now()) {
  return parseInbox(JSON.parse(await readFile(file(), "utf8").catch(() => "[]")), now);
}

// Scout results are QUIET. Keep them in the inbox for the client bell; never bypass owner preferences with an OS toast.
async function tick() {
  if (S.running || stopAllOn()) return;
  S.running = true;
  try {
    const now = Date.now();
    const fail = (e: unknown) => { console.error("[herald-watch]", msg(e)); return {}; }; // one source failing must not drop the others
    const [v, t, r] = await Promise.all([nicheViral(now, "herald").catch(fail), getTrends(now, "herald").catch(fail), reachFresh(now)]);
    const cards = [...viralCards(v), ...trendCards(t), ...(r.stopped ? [] : reachCards(r.items))];
    if (!cards.length) return;
    const old = JSON.parse(await readFile(file(), "utf8").catch(() => "[]")); // shortcut: a corrupt inbox restarts empty (it's only a cache)
    const { inbox, added } = mergeInbox(old, cards, now);
    if (!added.length) return;
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(inbox));
    await rename(file() + ".tmp", file());
  } catch (e) {
    console.error("[herald-watch]", msg(e));
  } finally { S.running = false; }
}

export function startHeraldWatch() {
  if (S.timer && S.tickFn === tick) return;
  if (S.timer) clearInterval(S.timer); // code was updated: swap in the new tick
  S.tickFn = tick;
  S.timer = setInterval(() => void tick(), 3 * 3_600_000);
  setTimeout(() => void tick(), 2 * 60_000);
}
