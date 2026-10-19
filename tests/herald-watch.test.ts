import { test } from "node:test";
import assert from "node:assert/strict";
import { AWAY_SUFFIX, INBOX_MAX, inboxOffer, mergeInbox, parseInbox, quietHours, toastPicks } from "../src/lib/herald-watch-pure.ts";
import type { HeraldCard } from "../src/lib/herald-pure.ts";

const at = (h: number, m = 0) => new Date(2026, 9, 18, h, m).getTime(); // local time, like the server
const D = 24 * 3_600_000;
const card = (key: string, clip = false): HeraldCard => ({ key, kind: "trend", title: key, body: "b", actions: clip ? [{ label: "Clip", nav: { panel: "studio", view: "clips" }, clip: "https://www.youtube.com/watch?v=abcdefghijk" }] : [] });

test("mergeInbox adds only new keys, stamps at, drops >3 days and caps at 30", () => {
  const T = at(15);
  const old = [{ ...card("a"), at: T - D }, { ...card("old"), at: T - 3 * D - 1 }, { junk: 1 }, null];
  const r = mergeInbox(old, [card("a"), card("b"), card("b")], T);
  assert.deepEqual(r.added.map((c) => [c.key, c.at]), [["b", T]]);
  assert.deepEqual(r.inbox.map((c) => c.key), ["a", "b"]);
  const many = Array.from({ length: 40 }, (_, i) => card(`k${i}`));
  const m = mergeInbox("garbage", many, T);
  assert.equal(m.inbox.length, INBOX_MAX);
  assert.equal(m.inbox.at(-1)?.key, "k39");
  assert.deepEqual(parseInbox(m.inbox, T + 3 * D), []);
});

test("toastPicks: clippable only, max 2, quiet 23:00-08:00", () => {
  const xs = [card("x"), card("a", true), card("b", true), card("c", true)];
  assert.deepEqual(toastPicks(xs, at(12)).map((c) => c.key), ["a", "b"]);
  assert.deepEqual(toastPicks(xs, at(23)), []);
  assert.deepEqual(toastPicks(xs, at(7, 59)), []);
  assert.equal(quietHours(at(8)), false);
  assert.equal(quietHours(at(22, 59)), false);
});

test("inboxOffer marks cards older than 10 min as found while away and strips at", () => {
  const T = at(12);
  const [fresh, old] = inboxOffer([{ ...card("f"), at: T - 60_000 }, { ...card("o"), at: T - 11 * 60_000 }], T);
  assert.equal(fresh.body, "b");
  assert.equal(old.body, "b" + AWAY_SUFFIX);
  assert.equal("at" in old, false);
});
