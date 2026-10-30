import { test } from "node:test";
import assert from "node:assert/strict";
import { dupPlan, findDuplicate, fingerprint, hash, normUrl, provenance, provenanceTags } from "../src/lib/memory-capture-pure.ts";

const row = (id: string, content: string, tags: string[] = [], url: string | null = null) => ({ id, title: id, content, tags, url, created_at: "2026-01-01T00:00:00Z" });

test("fingerprint ignores case, punctuation and spacing; hash is 16 hex", () => {
  assert.equal(fingerprint("Buy milk!"), fingerprint("buy   milk"));
  assert.notEqual(fingerprint("buy milk"), fingerprint("buy eggs"));
  assert.match(hash("x"), /^[0-9a-f]{16}$/);
});

test("normUrl drops tracking, hash, www and trailing slash", () => {
  assert.equal(normUrl("https://WWW.Example.com/a/?utm_source=x&b=2#top"), "https://example.com/a?b=2");
  assert.equal(normUrl("https://example.com/a"), normUrl("https://example.com/a/"));
});

test("provenance: one shape for note, link, voice and file", () => {
  assert.deepEqual(provenance({ source: "capture", content: "hi" }).kind, "note");
  assert.equal(provenance({ source: "url", content: "x", url: "https://a.com/p?utm_x=1" }).sourceId, "https://a.com/p");
  assert.equal(provenance({ source: "voice-memo", content: "x" }).kind, "voice");
  assert.equal(provenance({ source: "vault", content: "x", vault: "plan.pdf" }).sourceId, "vault:plan.pdf");
  const tags = provenanceTags(provenance({ source: "upload", content: "x", fileHash: "ab" }));
  assert.equal(tags.length, 3);
  assert.ok(tags.every((t) => t.length <= 40));
});

test("findDuplicate: stable source beats text; legacy rows by url or text; history and empty text never match", () => {
  const link = provenance({ source: "url", content: "new text", url: "https://a.com/p/" });
  assert.deepEqual(findDuplicate(link, [row("t", "new text"), row("u", "old", [], "https://www.a.com/p")]), { id: "u", title: "u", by: "source" });
  const note = provenance({ source: "capture", content: "Buy milk" });
  assert.equal(findDuplicate(note, [row("a", "buy milk.")])?.by, "content");
  assert.equal(findDuplicate(note, [row("a", "buy milk", ["superseded"])]), null);
  assert.equal(findDuplicate(provenance({ source: "capture", content: "" }), [row("a", "")]), null);
});

test("dupPlan: preview writes nothing; keep marks a version; merge folds text; update keeps history", () => {
  const ex = { id: "e1", content: "Alpha" };
  assert.ok("preview" in dupPlan(ex, "Beta"));
  assert.deepEqual(dupPlan(ex, "Beta", "keep"), { create: true, tags: ["v:e1"] });
  assert.deepEqual(dupPlan(ex, "Beta", "merge"), { create: false, content: "Alpha\n\nBeta" });
  assert.deepEqual(dupPlan(ex, "alpha", "merge"), { create: false, content: null });
  assert.deepEqual(dupPlan(ex, "Beta", "update"), { create: false, content: "Beta", history: true });
});
