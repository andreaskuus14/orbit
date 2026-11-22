import { test } from "node:test";
import assert from "node:assert/strict";
import { packById, packOrder, SOURCE_PACKS } from "../src/lib/source-packs-pure.ts";

test("source packs: https feeds, unique urls, every feed has a topic (so it lands in For you)", () => {
  const urls = SOURCE_PACKS.flatMap((p) => p.feeds.map((f) => f.url));
  assert.equal(new Set(urls).size, urls.length);
  for (const p of SOURCE_PACKS) for (const f of p.feeds) { assert.match(f.url, /^https:\/\//); assert.ok(f.topic && !["world", "economy", "politics"].includes(f.topic)); }
});

test("packOrder: packs matching his followed topics come first; packById rejects unknown ids", () => {
  const order = packOrder(["game development", "Roblox", "artificial intelligence", "YouTube creators"]).map((p) => p.id);
  assert.deepEqual(order.slice(0, 4).sort(), ["ai", "gamedev", "roblox", "youtube"]);
  assert.equal(order.length, SOURCE_PACKS.length);
  assert.equal(packById("roblox")?.feeds.length, 1);
  assert.equal(packById("nope"), null);
  assert.equal(packById(7), null);
});
