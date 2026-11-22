import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneToolsForIntent } from "../src/lib/core-mcp-pure.ts";
import { walkElevation, wallRects } from "../src/lib/arch-walk-pure.ts";
import type { Part } from "../src/lib/arch-pure.ts";
import { buildTestEzFuzzSpec, generateFuzzCases } from "../src/lib/roblox-fuzzer-pure.ts";
import { findProjectArtifacts, formatArtifactContext, recordArtifactPure } from "../src/lib/project-manifest-pure.ts";

test("pruneToolsForIntent keeps core essentials + intent-relevant tools under cap", () => {
  const all = [
    "search_memory", "save_memory", "web_search", "fetch_url", "read_more", "navigate", "plan_task",
    "ws_read", "ws_write", "ws_list", "run_code", "git_summary",
    "studio_status", "clips_list", "yt_upload",
    "business_status", "find_lead_candidates", "outreach_draft",
    "life_status", "life_add_habit", "calendar_events",
  ];
  const res = pruneToolsForIntent(all, "redesign my website html and fix css", { max: 12 });
  assert.equal(res.tools.length, 12);
  assert.equal(res.prunedCount, all.length - 12);
  assert.ok(res.tools.includes("search_memory"));
  assert.ok(res.tools.includes("ws_write"));
  assert.ok(res.tools.includes("ws_read"));
  assert.ok(!res.tools.includes("life_add_habit"), "irrelevant tools should be pruned first");
});

test("arch-walk-pure supports multi-storey floorY wall slicing and stair ramp walkElevation", () => {
  const parts: Part[] = [
    { id: "w1", name: "F1 Wall", kind: "wall", x: 0, y: 0, z: 0, w: 6, h: 2.8, d: 0.2 },
    { id: "w2", name: "F2 Wall", kind: "wall", x: 0, y: 3.0, z: 0, w: 6, h: 2.8, d: 0.2 },
    { id: "s1", name: "F2 Slab", kind: "slab", x: 5, y: 2.8, z: 0, w: 4, h: 0.2, d: 4 },
    { id: "st", name: "Main Stair", kind: "stair", x: 2, y: 0, z: 0, w: 3, h: 3.0, d: 1.2 },
  ];
  assert.equal(wallRects(parts, 0).length, 1);
  assert.equal(wallRects(parts, 3.0).length, 1);

  // Walking up the stair ramp smoothly increases elevation
  const yStart = walkElevation(0.6, 0, 0, parts);
  const yMid = walkElevation(1.0, 0, yStart, parts);
  assert.ok(yMid > yStart, `Expected ascent on stair (${yStart} -> ${yMid})`);
  // Standing on F2 slab at curY=2.8 returns 3.0
  assert.equal(walkElevation(5, 0, 2.8, parts), 3);
});

test("roblox-fuzzer-pure discovers server remotes, skips client scripts, and emits TestEZ spec", () => {
  const cases = generateFuzzCases([
    { file: "src/client/Gui.client.luau", text: "Buy.OnServerEvent:Connect(function(p, x) end)" },
    { file: "src/server/Shop.server.luau", text: "Buy.OnServerEvent:Connect(function(player, qty)\n  player.leaderstats.Coins.Value -= qty\nend)" },
  ]);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].remote, "Buy");
  assert.ok(cases[0].payloads.some((p) => p.category === "nan"));
  const spec = buildTestEzFuzzSpec(cases);
  assert.match(spec, /describe\("ORBIT RemoteEvent Security Fuzz Suite"/);
  assert.match(spec, /0\/0/);
});

test("project-manifest-pure shares verified-first artifacts across planets and enforces Rule 6 privacy", () => {
  const now = "2026-11-22T21:00:00Z";
  let items = recordArtifactPure([], {
    projectKey: "cyberforge",
    origin: "gamedev",
    kind: "script",
    title: "ShopServer hardened",
    summary: "5/5 exploit checks passed",
    ref: "src/server/Shop.server.luau",
    verified: true,
    tags: ["roblox"],
  }, now, () => "a1").items;

  // Rule 6 private text refused
  const blocked = recordArtifactPure(items, {
    projectKey: "cyberforge",
    origin: "chat",
    kind: "report",
    title: "My private diary",
    summary: "secret password",
    ref: "diary.md",
  }, now, () => "a2");
  assert.equal(blocked.saved, null);
  assert.match(blocked.reason ?? "", /Rule 6/);

  const found = findProjectArtifacts(items, "cyberforge");
  assert.equal(found.length, 1);
  const block = formatArtifactContext(found);
  assert.match(block, /PROJECT ARTIFACTS/);
  assert.match(block, /ShopServer hardened/);
});
