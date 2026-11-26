import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEED_WORLD, type Bug, type DevWorld } from "../src/lib/devworld-pure.ts";
import { KEEP_TOOLS, TOOL_IDS, counts, isGameTask, needsGame, removeBug, removeGame, restore, urgentBugs } from "../src/lib/gamedev-shell-pure.ts";
import { EN, ET } from "../src/lib/i18n-pure.ts";

const bug = (p: Partial<Bug>): Bug => ({ id: "b", game: SEED_WORLD.games[0].id, title: "t", detail: "", severity: "minor", status: "open", created: "2026-11-01T00:00:00.000Z", ...p });
const world = (): DevWorld => structuredClone(SEED_WORLD);

test("all 24 tools are listed once, keep-tools are real tools", () => {
  assert.equal(TOOL_IDS.length, 24);
  assert.equal(new Set(TOOL_IDS).size, 24);
  for (const k of KEEP_TOOLS) assert.ok(TOOL_IDS.includes(k));
  assert.equal(needsGame("trends"), false);
  assert.equal(needsGame("refs"), true);
});

test("urgent bugs: open crash before major, newest first, no minor, no orphans", () => {
  const w = world(), g = w.games[0].id;
  w.bugs = [bug({ id: "m1", severity: "major", created: "2026-11-02T00:00:00Z", game: g }), bug({ id: "c1", severity: "crash", created: "2026-11-01T00:00:00Z", game: g }),
    bug({ id: "m2", severity: "major", created: "2026-11-03T00:00:00Z", game: g }), bug({ id: "x", severity: "minor", game: g }),
    bug({ id: "f", severity: "crash", status: "fixed", game: g }), bug({ id: "o", severity: "crash", game: "gone" })];
  assert.deepEqual(urgentBugs(w).map((x) => x.bug.id), ["c1", "m2", "m1"]);
  assert.deepEqual(counts(w), { games: w.games.length, open: 4, urgent: 3 });
  assert.deepEqual(urgentBugs(null), []);
});

test("delete a game with Undo puts the game and its bugs back in place, keeping later edits", () => {
  const w = world(), g = w.games[0];
  w.bugs = [bug({ id: "a", game: g.id }), bug({ id: "b2", game: w.games[1]?.id ?? "other" }), bug({ id: "c", game: g.id })];
  const r = removeGame(w, g.id);
  assert.ok(!r.world.games.some((x) => x.id === g.id));
  assert.deepEqual(r.world.bugs.map((b) => b.id), ["b2"]);
  const later = { ...r.world, bugs: [...r.world.bugs, bug({ id: "new", game: "other" })] };
  const back = restore(later, r.removed);
  assert.equal(back.games[0].id, g.id);
  assert.deepEqual(back.bugs.map((b) => b.id), ["a", "b2", "c", "new"]);
  assert.deepEqual(restore(back, r.removed), back, "a second Undo changes nothing");
});

test("delete one bug with Undo", () => {
  const w = world(); w.bugs = [bug({ id: "a" }), bug({ id: "b" }), bug({ id: "c" })];
  const r = removeBug(w, "b");
  assert.deepEqual(r.world.bugs.map((b) => b.id), ["a", "c"]);
  assert.deepEqual(restore(r.world, r.removed).bugs.map((b) => b.id), ["a", "b", "c"]);
  assert.deepEqual(removeBug(w, "nope").removed.bugs, []);
});

test("only QA playtest plans count as GAME DEV work", () => {
  assert.ok(isGameTask({ agent: "qa", title: 'Playtest plan: "Pet Sim"' }));
  assert.ok(!isGameTask({ agent: "qa", title: "Something else" }));
  assert.ok(!isGameTask({ agent: "forge", title: "Playtest plan: x" }));
});

test("every gx.* key has English and Estonian text", () => {
  const keys = Object.keys(EN).filter((k) => k.startsWith("gx."));
  assert.ok(keys.length > 150);
  for (const k of keys) assert.ok((ET as Record<string, string>)[k], `ET missing ${k}`);
  for (const id of TOOL_IDS) { assert.ok((EN as Record<string, string>)[`gx.t.${id}`]); assert.ok((EN as Record<string, string>)[`gx.h.${id}`]); }
});

test("DevWorld: no static tool imports, no confirm(), no emoji, stars and bloom follow quality", () => {
  const src = readFileSync(new URL("../src/components/DevWorld.tsx", import.meta.url), "utf8");
  for (const m of ["RefBoard", "SoundFinder", "ThumbMaker", "TrendRadar", "CodeHelper", "RojoPanel", "ScenePlanner", "TextureStudio", "PlaytestBot", "HivePanel", "GridCity", "LocalAi"])
    assert.ok(!new RegExp(`^import [^\\n]*from "\\./${m}"`, "m").test(src), `${m} is imported statically`);
  assert.ok(!/\bconfirm\(/.test(src));
  assert.ok(!/\p{Extended_Pictographic}/u.test(src), "emoji in DevWorld");
  assert.match(src, /q\.stars/);
  assert.match(src, /q\.bloomScale > 0 &&|<WorldFX scale={q\.bloomScale}/); // WorldFX draws nothing at scale 0
});
