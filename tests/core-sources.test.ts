import { test } from "node:test";
import assert from "node:assert/strict";
import { citedLinks, normUrl, unseenLinks, unseenNote } from "../src/lib/core-sources-pure.ts";

const TOOL = "- CLT prices rose about 8% (market note): https://example-timber.test/baltic-clt-q4\n";
const ANSWER = "Rose 8% ([note](https://example-timber.test/baltic-clt-q4)). Suppliers quote 700 ([ERR](https://news.err.ee/clt-prices-2026-11)).";

test("a link no tool returned is unseen; the one web_search returned is not (Agent 7's repro)", () => {
  assert.deepEqual(unseenLinks(ANSWER, [TOOL]), ["https://news.err.ee/clt-prices-2026-11"]);
  assert.equal(citedLinks(ANSWER), 2);
});

test("same page counts as seen despite www, trailing slash, fragment, host case or trailing punctuation", () => {
  const seen = ["see https://www.Example.com/a/b/?x=1#top"];
  assert.deepEqual(unseenLinks("Per https://example.com/a/b?x=1. and [t](https://EXAMPLE.com/a/b/?x=1#s).", seen), []);
  assert.deepEqual(unseenLinks("https://example.com/a/b?x=2", seen), ["https://example.com/a/b?x=2"]); // other query = other page
  assert.deepEqual(unseenLinks("https://example.com/A/b?x=1", seen), ["https://example.com/A/b?x=1"]); // paths are case-sensitive
});

test("links from memories, attachments or chat text in the prompt count as seen; local and relative links are ignored", () => {
  assert.deepEqual(unseenLinks("From [memo](https://docs.test/plan) and [here](/api/vault?file=a.txt) and http://localhost:3000/x", ["<memory>Plan: https://docs.test/plan</memory>"]), []);
  assert.equal(citedLinks("[here](/api/vault?file=a.txt) http://127.0.0.1:3000/"), 0);
});

test("duplicates are reported once; the note names at most 5 and is empty when all were seen", () => {
  const urls = unseenLinks("https://a.test/1 https://a.test/1 https://b.test https://c.test https://d.test https://e.test https://f.test", []);
  assert.equal(urls.length, 6);
  assert.equal(unseenNote([]), "");
  assert.match(unseenNote(urls.slice(0, 1)), /didn't open this source this turn, so it is unchecked: <https:\/\/a\.test\/1>/);
  const many = unseenNote(urls);
  assert.match(many, /these 6 sources/);
  assert.ok(!many.includes("f.test") && many.includes(", …"));
});
