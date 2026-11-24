// GAME DEV planet shell (design language + MIX look): the tool list, what needs him, what's running, and delete-with-Undo.
// Pure: no React, no fetch. Labels are i18n keys ("gx.*"); the component translates them.
import { isActive, type Bug, type DevWorld, type Game, type Severity } from "./devworld-pure.ts";

/** Every GAME DEV tool, grouped for the "All tools" sheet. `game` = needs a picked game. Order = order in the sheet. */
export const TOOL_GROUPS = [
  { id: "projects", tools: [["trends", false], ["hive", false], ["sessions", false], ["core", false]] },
  { id: "overview", tools: [["economy", true], ["sim", true]] },
  { id: "build", tools: [["scene", true], ["code", false], ["files", true], ["grid", true]] },
  { id: "test", tools: [["evidence", true], ["playtest", true], ["aitesters", true], ["personas", true]] },
  { id: "assets", tools: [["register", true], ["uikit", true], ["refs", true], ["textures", true], ["sounds", true], ["thumbs", true], ["model3d", true], ["text3d", true]] },
  { id: "release", tools: [["release", true], ["retention", true]] },
] as const;
export type ToolId = (typeof TOOL_GROUPS)[number]["tools"][number][0];
export const TOOL_IDS: ToolId[] = TOOL_GROUPS.flatMap((g) => g.tools.map(([id]) => id as ToolId));
export const needsGame = (id: ToolId) => TOOL_GROUPS.some((g) => g.tools.some(([k, need]) => k === id && need));
/** Tools that may hold running work (a playtest run, a fix draft): kept once opened so leaving them doesn't lose it. Others unmount. */
export const KEEP_TOOLS: readonly ToolId[] = ["playtest", "code"];

const SEV_RANK: Record<Severity, number> = { crash: 0, major: 1, minor: 2, polish: 3 };

/** Needs you: open crash/major bugs across all games, worst first, newest first within a severity. */
export function urgentBugs(w: DevWorld | null, max = 4): { bug: Bug; game: Game }[] {
  if (!w) return [];
  const byId = new Map(w.games.map((g) => [g.id, g]));
  return w.bugs
    .filter((b) => isActive(b) && (b.severity === "crash" || b.severity === "major") && byId.has(b.game))
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || Date.parse(b.created) - Date.parse(a.created))
    .slice(0, max)
    .map((bug) => ({ bug, game: byId.get(bug.game)! }));
}

/** Status line counts (≤ 40 characters once translated): games and open bugs. */
export function counts(w: DevWorld | null): { games: number; open: number; urgent: number } {
  if (!w) return { games: 0, open: 0, urgent: 0 };
  const known = new Set(w.games.map((g) => g.id));
  const open = w.bugs.filter((b) => isActive(b) && known.has(b.game));
  return { games: w.games.length, open: open.length, urgent: open.filter((b) => b.severity === "crash" || b.severity === "major").length };
}

/** Is this task one of GAME DEV's own (a QA playtest plan started from a game)? */
export const isGameTask = (t: { agent?: string | null; title?: string | null }) => t.agent === "qa" && /^Playtest plan:/.test(t.title ?? "");

/* ---------- delete with Undo: remove now, put back exactly where it was ---------- */

export type Removed = { games: { at: number; item: Game }[]; bugs: { at: number; item: Bug }[] };

export function removeGame(w: DevWorld, id: string): { world: DevWorld; removed: Removed } {
  const removed: Removed = { games: [], bugs: [] };
  w.games.forEach((g, at) => { if (g.id === id) removed.games.push({ at, item: g }); });
  w.bugs.forEach((b, at) => { if (b.game === id) removed.bugs.push({ at, item: b }); });
  return { world: { ...w, games: w.games.filter((g) => g.id !== id), bugs: w.bugs.filter((b) => b.game !== id) }, removed };
}

export function removeBug(w: DevWorld, id: string): { world: DevWorld; removed: Removed } {
  const at = w.bugs.findIndex((b) => b.id === id);
  return { world: { ...w, bugs: w.bugs.filter((b) => b.id !== id) }, removed: { games: [], bugs: at < 0 ? [] : [{ at, item: w.bugs[at] }] } };
}

/** Undo on the CURRENT world (edits made since the delete stay). Skips anything already back (double Undo, another tab). */
export function restore(w: DevWorld, r: Removed): DevWorld {
  const put = <T extends { id: string }>(list: T[], back: { at: number; item: T }[]) => {
    const out = [...list], have = new Set(list.map((x) => x.id));
    for (const { at, item } of [...back].sort((a, b) => a.at - b.at)) if (!have.has(item.id)) out.splice(Math.min(at, out.length), 0, item);
    return out;
  };
  return { ...w, games: put(w.games, r.games), bugs: put(w.bugs, r.bugs) };
}
