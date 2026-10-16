import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFollowCommand, followAck, followReply, cleanTopic, needsRefresh, isNew, newest, age, REFRESH_MS } from "../src/lib/follows-pure.ts";

test("follow / unfollow commands", () => {
  const yes: [string, object][] = [
    ["follow Estonia", { action: "follow", topic: "Estonia" }],
    ["Follow AI", { action: "follow", topic: "AI" }],
    ["Hey Orbit, follow Jynxzi please", { action: "follow", topic: "Jynxzi" }],
    ["unfollow YouTube.", { action: "unfollow", topic: "YouTube" }],
    ["stop following news about Roblox", { action: "unfollow", topic: "Roblox" }],
    ["start following the news on Elon Musk", { action: "follow", topic: "Elon Musk" }],
    ["orbit unfollow artificial intelligence", { action: "unfollow", topic: "artificial intelligence" }],
    ["follow Estonia news", { action: "follow", topic: "Estonia" }],
  ];
  for (const [t, want] of yes) assert.deepEqual(parseFollowCommand(t), want, t);
  for (const t of ["follow up with John tomorrow", "follow me", "follow the instructions", "should I follow Jynxzi?", "do you follow AI",
    "follow", "follow x", "follow this guy on twitter", "follow along", "open the news", "follow a really long sentence that keeps going on"])
    assert.equal(parseFollowCommand(t), null, t);
});

test("cleanTopic validates", () => {
  assert.equal(cleanTopic("  \"C++\" "), "C++");
  assert.equal(cleanTopic("a"), null);
  assert.equal(cleanTopic("<script>"), null);
  assert.equal(cleanTopic(42), null);
  assert.equal(cleanTopic("x".repeat(61)), null);
});

test("refresh is throttled to every 30 minutes", () => {
  const now = 1_000_000_000;
  assert.equal(needsRefresh(undefined, now), true);
  assert.equal(needsRefresh(now - 60_000, now), false);
  assert.equal(needsRefresh(now - REFRESH_MS + 1, now), false);
  assert.equal(needsRefresh(now - REFRESH_MS, now), true);
  assert.equal(needsRefresh(now + 60_000, now), true); // clock went backwards: don't stay stuck on old news
});

test("new since last visit, newest 3, age", () => {
  const h = (title: string, iso: string | null) => ({ title, url: `https://x/${title}`, source: "S", published_at: iso });
  const since = Date.parse("2026-10-16T08:00:00Z");
  assert.equal(isNew(h("a", "2026-10-16T09:00:00Z"), since), true);
  assert.equal(isNew(h("a", "2026-10-16T07:00:00Z"), since), false);
  assert.equal(isNew(h("a", null), since), false);
  const list = newest([h("old", "2026-10-14T00:00:00Z"), h("New one", "2026-10-16T09:00:00Z"), h("new one!", "2026-10-16T08:30:00Z"), h("mid", "2026-10-15T00:00:00Z"), h("x", null)]);
  assert.deepEqual(list.map((x) => x.title), ["New one", "mid", "old"]);
  const now = Date.parse("2026-10-16T10:00:00Z");
  assert.equal(age("2026-10-16T09:55:00Z", now), "5m");
  assert.equal(age("2026-10-16T07:00:00Z", now), "3h");
  assert.equal(age("2026-10-13T10:00:00Z", now), "3d");
  assert.equal(age(null, now), "");
});

test("everyday phrases are not topics", () => {
  for (const t of ["follow the news", "follow a strict diet plan", "keep an eye on the oven", "follow orders", "follow best practices",
    "follow the", "follow an idea", "follow some advice", "follow the news please"])
    assert.equal(parseFollowCommand(t), null, t);
  assert.deepEqual(parseFollowCommand("follow the Fed"), { action: "follow", topic: "the Fed" });
  assert.deepEqual(parseFollowCommand("follow the news about AI please"), { action: "follow", topic: "AI" });
});

test("replies report the real outcome", () => {
  const c = { action: "unfollow" as const, topic: "AI" };
  assert.equal(followAck(c), "Unfollowing AI…");
  assert.equal(followReply(c), "Stopped following AI.");
  assert.equal(followReply(c, false), "You weren't following AI.");
});
