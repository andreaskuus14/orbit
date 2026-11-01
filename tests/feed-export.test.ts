import test from "node:test";
import assert from "node:assert/strict";
import { feedsOpml } from "../src/lib/feed-export-pure.ts";

test("OPML exports subscriptions with safe XML, valid URLs and no duplicates or embedded credentials", () => {
  const result = feedsOpml([
    { url: "https://example.com/feed?a=1&b=2", title: 'News <&> "today"', topic: null },
    { url: "https://example.com/feed?a=1&b=2", title: "Duplicate", topic: null },
    { url: "https://example.org/rss", title: null, topic: "Roblox" },
    { url: "https://user:secret@example.org/rss", title: "Secret", topic: null },
    { url: "javascript:alert(1)", title: "Bad", topic: null },
    { url: "invalid", title: null, topic: null },
  ]);
  assert.match(result, /<opml version="2.0">/);
  assert.equal((result.match(/<outline /g) ?? []).length, 2);
  assert.match(result, /text="News &lt;&amp;&gt; &quot;today&quot;"/);
  assert.match(result, /xmlUrl="https:\/\/example.com\/feed\?a=1&amp;b=2"/);
  assert.match(result, /text="Roblox"/);
  assert.doesNotMatch(result, /secret|javascript|Duplicate/);
  assert.match(feedsOpml([]), /<body>\n\n  <\/body>/);
});
