import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractToolFailure,
  formatMistakesBlock,
  isSafeMistakeInput,
  matchMistakes,
  MAX_BLOCK_CHARS,
  MAX_INJECT,
  recordMistakePure,
  type Mistake,
} from "../src/lib/mistake-memory-pure.ts";

test("isSafeMistakeInput enforces Rule 6: blocks journal/LIFE, private tags, credentials, and emails", () => {
  assert.equal(isSafeMistakeInput({ trigger: "Roblox Rojo export", mistake: "skipped Selene", fix: "run Selene first" }).ok, true);
  assert.equal(isSafeMistakeInput({ kind: "journal", trigger: "x", mistake: "y", fix: "z" }).ok, false);
  assert.equal(isSafeMistakeInput({ tags: ["private"], trigger: "x", mistake: "y", fix: "z" }).ok, false);
  assert.equal(isSafeMistakeInput({ trigger: "my journal entry", mistake: "y", fix: "z" }).ok, false);
  assert.equal(isSafeMistakeInput({ trigger: "email client@example.com", mistake: "y", fix: "z" }).ok, false);
  assert.equal(isSafeMistakeInput({ trigger: "key sk-ant-api03-abcdefgh12345678", mistake: "y", fix: "z" }).ok, false); // secret-scan: allow
  assert.equal(isSafeMistakeInput({ trigger: "", mistake: "y", fix: "z" }).ok, false);
});

test("recordMistakePure deduplicates matching mistakes, bumps hits, and updates fix", () => {
  let n = 0;
  const id = () => `m-${++n}`;
  const r1 = recordMistakePure([], { area: "gamedev", trigger: "building Roblox pet simulator shop", mistake: "forgetting studio_id lookup", fix: "look up studio_id first", tool: "roblox_write", tags: ["roblox"] }, "2026-11-21T10:00:00Z", id);
  assert.equal(r1.items.length, 1);
  assert.equal(r1.saved?.hits, 1);

  const r2 = recordMistakePure(r1.items, { area: "gamedev", trigger: "building Roblox pet simulator shop", mistake: "forgetting studio_id lookup", fix: "always look up studio_id and verify objects after write", tags: ["studio"] }, "2026-11-21T11:00:00Z", id);
  assert.equal(r2.items.length, 1);
  assert.equal(r2.saved?.hits, 2);
  assert.match(r2.saved?.fix ?? "", /verify objects/);
  assert.deepEqual(r2.saved?.tags.sort(), ["roblox", "studio"]);
});

test("matchMistakes injects ONLY high-relevance mistakes (top 2 cap) and stays silent on unrelated queries", () => {
  const items: Mistake[] = [
    { id: "1", area: "gamedev", trigger: "Roblox Studio Rojo build", mistake: "skipping Selene lint", fix: "run Selene before finishing", tool: "roblox_write", tags: ["roblox", "rojo", "luau"], hits: 3, status: "active", createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-21T00:00:00Z" },
    { id: "2", area: "studio", trigger: "YouTube Shorts captions timing", mistake: "long 4-line subtitle chunks", fix: "keep captions to max 2 short lines", tags: ["youtube", "shorts", "captions"], hits: 2, status: "active", createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-21T00:00:00Z" },
    { id: "3", area: "gamedev", trigger: "Roblox Luau RemoteEvent handler", mistake: "trusting client Coins value", fix: "validate amount server-side", tags: ["roblox", "luau", "exploit"], hits: 1, status: "active", createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-21T00:00:00Z" },
    { id: "4", area: "gamedev", trigger: "archived Roblox hint", mistake: "old bug", fix: "old fix", tags: ["roblox"], hits: 10, status: "archived", createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-21T00:00:00Z" },
  ];

  // Unrelated query -> zero prompt bloat
  assert.deepEqual(matchMistakes(items, "what is the weather in Tallinn tomorrow?"), []);

  // Roblox query -> returns top 2 active Roblox mistakes, skips archived & YouTube
  const hits = matchMistakes(items, "fix my Roblox Luau RemoteEvent and Rojo build");
  assert.equal(hits.length, MAX_INJECT);
  assert.deepEqual(hits.map((h) => h.id), ["1", "3"]);

  // Prompt block stays compact
  const block = formatMistakesBlock(hits);
  assert.ok(block.length > 40 && block.length <= MAX_BLOCK_CHARS);
  assert.match(block, /Past mistakes to avoid/);
  assert.match(block, /Selene/);
});

test("extractToolFailure ignores transient errors and captures actionable deterministic failures", () => {
  assert.equal(extractToolFailure("web_search", { query: "test" }, "Error: fetch timed out"), null);
  assert.equal(extractToolFailure("ask_agent", {}, "Error: usage limit reached"), null);
  const c = extractToolFailure("lead_create", { leads: "[]", workspace: "biz" }, "Error: leads must be an array");
  assert.ok(c);
  assert.equal(c.tool, "lead_create");
  assert.match(c.mistake, /leads must be an array/);
});
