// "The Machine": Trend Radar snapshot history → games rising before they peak. Pure; tested in tests/trend-rise.test.ts.
import type { TrendSort } from "./devtools-pure.ts";

export type SnapGame = { id: number; place: number; name: string; players: number; ranks: Record<string, number> };
export type Snap = { at: number; games: SnapGame[] };
export type Riser = { universeId: number; placeId: number; name: string; players: number; growthPct: number; rankJump: number; window: "1h" | "24h"; strong: boolean };

const H = 3600_000;
export const KEEP_MS = 7 * 24 * H, KEEP_MAX = 200;
export const MIN_PLAYERS = 1000; // now — tiny games never count
export const MIN_BASE = 200; // then — avoids 5 → 50 = "+900%"
// window: how old the base snapshot may be, and growth % that counts as rising / strong
const WINDOWS = [
  { name: "1h", min: 0.6 * H, max: 3 * H, rise: 25, strong: 100 },
  { name: "24h", min: 18 * H, max: 36 * H, rise: 50, strong: 200 },
] as const;
const RANK_RISE = 5, RANK_STRONG = 10;

/** Current lists → one compact snapshot (rank = 1-based position per sort id). */
export function toSnapshot(sorts: TrendSort[], at: number): Snap {
  const m = new Map<number, SnapGame>();
  for (const s of sorts) s.games.forEach((g, i) => {
    const x = m.get(g.universeId) ?? { id: g.universeId, place: g.placeId, name: g.name, players: g.players, ranks: {} };
    x.ranks[s.id] = i + 1;
    m.set(g.universeId, x);
  });
  return { at, games: [...m.values()] };
}

/** File JSON → snapshots, malformed ones dropped, oldest first. */
export function parseSnaps(j: unknown): Snap[] {
  if (!Array.isArray(j)) return [];
  return j.filter((s): s is Snap => !!s && typeof s.at === "number" && Array.isArray(s.games))
    .map((s) => ({ at: s.at, games: s.games.filter((g) => g && typeof g.id === "number" && typeof g.players === "number" && g.ranks && typeof g.ranks === "object") }))
    .sort((a, b) => a.at - b.at);
}

/** Add a snapshot and keep the last 7 days, at most 200. */
export const pushSnap = (list: Snap[], s: Snap): Snap[] => [...list, s].filter((x) => s.at - x.at <= KEEP_MS).slice(-KEEP_MAX);

/** Compare the newest snapshot with ~1 h and ~24 h earlier ones; best window per game, biggest growth first. */
export function findRisers(snaps: Snap[], limit = 10): Riser[] {
  const now = snaps.at(-1);
  if (!now) return [];
  const best = new Map<number, Riser>();
  for (const w of WINDOWS) {
    // the base closest to (now - window centre) within the allowed age range
    const target = now.at - (w.name === "1h" ? H : 24 * H);
    const base = snaps.filter((s) => now.at - s.at >= w.min && now.at - s.at <= w.max).sort((a, b) => Math.abs(a.at - target) - Math.abs(b.at - target))[0];
    if (!base) continue;
    const prev = new Map(base.games.map((g) => [g.id, g]));
    for (const g of now.games) {
      const p = prev.get(g.id);
      if (!p || g.players < MIN_PLAYERS || p.players < MIN_BASE) continue;
      const growthPct = Math.round(((g.players - p.players) / p.players) * 100);
      const rankJump = Math.max(0, ...Object.keys(g.ranks).filter((k) => p.ranks[k]).map((k) => p.ranks[k] - g.ranks[k]));
      if (growthPct < w.rise && rankJump < RANK_RISE) continue;
      const r: Riser = { universeId: g.id, placeId: g.place, name: g.name, players: g.players, growthPct, rankJump, window: w.name, strong: growthPct >= w.strong || rankJump >= RANK_STRONG };
      const o = best.get(g.id);
      if (!o || r.growthPct > o.growthPct) best.set(g.id, r);
    }
  }
  return [...best.values()].sort((a, b) => b.growthPct - a.growthPct || b.rankJump - a.rankJump).slice(0, limit);
}

/** Strong risers not yet alerted today; returns them plus the updated "alerted" map (universeId → YYYY-MM-DD). */
export function dueAlerts(risers: Riser[], alerted: Record<string, string>, day: string): { due: Riser[]; next: Record<string, string> } {
  const due = risers.filter((r) => r.strong && alerted[r.universeId] !== day);
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(alerted)) if (v === day) next[k] = v; // drop older days so the map stays small
  for (const r of due) next[r.universeId] = day;
  return { due, next };
}
