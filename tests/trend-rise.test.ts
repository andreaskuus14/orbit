import { test } from "node:test";
import assert from "node:assert/strict";
import { toSnapshot, parseSnaps, pushSnap, findRisers, dueAlerts, KEEP_MAX, type Snap } from "../src/lib/trend-rise-pure.ts";

const H = 3600_000, T = 1_700_000_000_000;
const game = (id: number, players: number) => ({ universeId: id, placeId: id * 10, name: `G${id}`, players, upvotePct: 90, genre: null, icon: null });
const snap = (at: number, games: [number, number][], sort = "top-trending"): Snap => toSnapshot([{ id: sort, name: sort, games: games.map(([id, p]) => game(id, p)) }], at);

test("toSnapshot keeps ranks per sort", () => {
  const s = toSnapshot([{ id: "a", name: "A", games: [game(1, 5), game(2, 6)] }, { id: "b", name: "B", games: [game(2, 6)] }], T);
  assert.deepEqual(s.games.find((g) => g.id === 2)?.ranks, { a: 2, b: 1 });
});

test("1h growth riser; tiny games and small growth ignored", () => {
  const r = findRisers([snap(T - H, [[1, 2000], [2, 50], [3, 10000]]), snap(T, [[1, 5000], [2, 900], [3, 10500]])]);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].universeId, r[0].growthPct, r[0].window, r[0].strong, r[0].placeId], [1, 150, "1h", true, 10]);
});

test("rank jump counts even with modest growth", () => {
  const before = snap(T - 24 * H, [[9, 3000], ...Array.from({ length: 11 }, (_, i) => [100 + i, 9000] as [number, number]), [1, 2000]]);
  const r = findRisers([before, snap(T, [[1, 2200], [9, 3000]])]);
  assert.equal(r[0].universeId, 1);
  assert.equal(r[0].rankJump, 12);
  assert.equal(r[0].window, "24h");
  assert.equal(r[0].strong, true);
});

test("no base snapshot in range → nothing", () => {
  assert.deepEqual(findRisers([snap(T - 10 * 60_000, [[1, 1000]]), snap(T, [[1, 9000]])]), []);
  assert.deepEqual(findRisers([]), []);
});

test("pushSnap caps age and count; parseSnaps drops junk", () => {
  let l: Snap[] = [snap(T - 8 * 24 * H, [])];
  l = pushSnap(l, snap(T, []));
  assert.equal(l.length, 1);
  for (let i = 0; i < KEEP_MAX + 5; i++) l = pushSnap(l, snap(T + i, []));
  assert.equal(l.length, KEEP_MAX);
  assert.deepEqual(parseSnaps([null, { at: "x" }, { at: 2, games: [] }, { at: 1, games: [{ id: 1 }] }]).map((s) => s.at), [1, 2]);
  assert.deepEqual(parseSnaps("nope"), []);
});

test("dueAlerts: once per game per day", () => {
  const rs = findRisers([snap(T - H, [[1, 2000]]), snap(T, [[1, 5000]])]);
  const a = dueAlerts(rs, { "7": "2026-10-17" }, "2026-10-18");
  assert.equal(a.due.length, 1);
  assert.deepEqual(a.next, { "1": "2026-10-18" });
  assert.equal(dueAlerts(rs, a.next, "2026-10-18").due.length, 0);
});
