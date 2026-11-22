import { test } from "node:test";
import assert from "node:assert/strict";
import { isJunk, isSport, outletName } from "../src/lib/news-quality-pure.ts";

test("isJunk: real topic search hits from 22 Nov — advice and guides out, reporting in", () => {
  assert.ok(isJunk({ title: "Nvidia Just Delivered Incredible Results. Buy This Artificial Intelligence Stock", source: "Yahoo Finance" }));
  assert.ok(isJunk({ title: "41.6% of Berkshire Hathaway's $358 Billion Portfolio Is Parked in 3 AI Stocks", source: "The Motley Fool" }));
  assert.ok(isJunk({ title: "Dandy's World The Lab Game Mode Guide – Roblox", source: "Pro Game Guides" }));
  assert.ok(!isJunk({ title: "Roblox still lacks effective tools to moderate Arabic chat", source: "The National on MSN" }));
  assert.ok(!isJunk({ title: "Atari E.T. creator likens the deluge of AI games to the lead-up to the 1983 crash", source: "PC Gamer on MSN" }));
  assert.ok(!isJunk({ title: "YouTube nears $3 billion settlement over student addiction claims", source: "Moneycontrol" }));
});

test("outletName: Microsoft Start's ' on MSN' is dropped", () => {
  assert.equal(outletName("Polygon on MSN"), "Polygon");
  assert.equal(outletName(null), "");
});

test("isSport: the 22 Nov world-feed sport items are sport; world news is not", () => {
  assert.ok(isSport("Max Verstappen wins F1 Las Vegas Grand Prix for third time in four years"));
  assert.ok(isSport("Wembanyama scores 50 points, bags 19 rebounds in Spurs' 14th win of season"));
  assert.ok(isSport("Gukesh vs Sindarov: The youngest World Chess Championship in history"));
  assert.ok(!isSport("South Korea education minister resigns over exam cheating scandal"));
  assert.ok(!isSport("Indonesia factory fire kills three, 36 missing"));
  assert.ok(!isSport("COP31 climate talks close to final deal, summit president says"));
});
