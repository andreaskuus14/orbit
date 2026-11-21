import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chatBlocks, chatSwRoute, composerKey, isLong, likePattern, mediaKind, nearBottom, ownUrl, searchQuery, snippet, titleHits, turnProgress, wantsPhotoText,
} from "../src/lib/core-chat-pure.ts";

test("chatBlocks: code fences, with language, and an unfinished fence while streaming", () => {
  const b = chatBlocks("Here:\n```lua\nprint(1)\n```\nDone.");
  assert.deepEqual(b.map((x) => x.kind), ["text", "code", "text"]);
  assert.deepEqual(b[1], { kind: "code", lang: "lua", code: "print(1)", open: false });
  const s = chatBlocks("Here:\n```ts\nconst a = 1;");
  assert.equal(s[1].kind === "code" && s[1].open, true);
  assert.equal(s[1].kind === "code" && s[1].code, "const a = 1;");
});

test("chatBlocks: a markdown table becomes a table with alignment; ragged rows are padded", () => {
  const b = chatBlocks("| Pets | ms |\n|:---|---:|\n| 10 | 4 |\n| 40 |\nafter");
  assert.equal(b[0].kind, "table");
  if (b[0].kind !== "table") return;
  assert.deepEqual(b[0].head, ["Pets", "ms"]);
  assert.deepEqual(b[0].align, ["left", "right"]);
  assert.deepEqual(b[0].rows, [["10", "4"], ["40", ""]]);
  assert.equal(b[1].kind, "text");
  // pipes without a rule line stay text
  assert.equal(chatBlocks("| not | a table |")[0].kind, "text");
});

test("chatBlocks: ORBIT's own media lines show inline; outside links and 3D stay cards", () => {
  const img = chatBlocks("![cat](/api/workspace?ws=a&file=cat.png&download=1)")[0];
  assert.deepEqual(img, { kind: "media", media: "image", url: "/api/workspace?ws=a&file=cat.png&download=1", label: "cat", inline: true });
  const ext = chatBlocks("https://example.com/x.png")[0];
  assert.equal(ext.kind === "media" && ext.inline, false);
  const glb = chatBlocks("[model](/api/workspace?ws=a&file=pet.glb)")[0];
  assert.equal(glb.kind === "media" && glb.media === "model" && !glb.inline, true);
  // a plain http link (not https) or a link inside a sentence is just text
  assert.equal(chatBlocks("http://example.com/x.png")[0].kind, "text");
  assert.equal(chatBlocks("see /api/x.png for it")[0].kind, "text");
});

test("ownUrl: only ORBIT's /api and /w paths, never protocol-relative or traversal", () => {
  assert.equal(ownUrl("/api/workspace?file=a.png"), true);
  assert.equal(ownUrl("//evil.com/a.png"), false);
  assert.equal(ownUrl("/api/../../etc/passwd.png"), false);
  assert.equal(ownUrl("/api/%2e%2e/x.png"), false);
  assert.equal(ownUrl("/static/a.png"), false);
  assert.equal(ownUrl("https://x.com/a.png"), false);
});

test("mediaKind: by path or file= query", () => {
  assert.equal(mediaKind("/api/workspace?ws=a&file=song.mp3"), "audio");
  assert.equal(mediaKind("/w/a/clip.mp4"), "video");
  assert.equal(mediaKind("/api/x/report.pdf"), "pdf");
  assert.equal(mediaKind("/api/x/notes.txt"), null);
});

test("isLong and composerKey", () => {
  assert.equal(isLong("short"), false);
  assert.equal(isLong("x\n".repeat(70)), true);
  assert.equal(composerKey({ key: "Enter", shiftKey: false }), "send");
  assert.equal(composerKey({ key: "Enter", shiftKey: true }), null);
  assert.equal(composerKey({ key: "Enter", shiftKey: false, isComposing: true }), null);
  assert.equal(composerKey({ key: "Enter", shiftKey: false, keyCode: 229 }), null);
  assert.equal(composerKey({ key: "a", shiftKey: false }), null);
});

test("nearBottom", () => {
  assert.equal(nearBottom(1000, 560, 400), true);
  assert.equal(nearBottom(1000, 300, 400), false);
});

test("turnProgress: steps in plain words, then writing; open action only when handed off", () => {
  const p = turnProgress({ id: "t", title: "Fix lag", rows: [{ label: "Searching memory…", tool: "search_memory", ok: true }, { label: "Web", tool: "web_search" }], streaming: false, taskId: null, startedAt: 0, lang: "en" });
  assert.deepEqual(p.steps.map((s) => s.state), ["done", "now", "next"]);
  assert.equal(p.steps.at(-1)?.label, "Writing the answer");
  assert.equal(p.phase, "working");
  assert.equal(p.action, null);
  const w = turnProgress({ id: "t", title: "x", rows: [{ label: "a", tool: "search_memory", ok: true }], streaming: true, taskId: "abc", startedAt: 0, lang: "et" });
  assert.equal(w.now, "Kirjutan vastust");
  assert.equal(w.action?.open, "#o=operations&k=task&id=abc");
});

test("search helpers: query, ilike escaping, snippet, title filter", () => {
  assert.equal(searchQuery(" a "), null);
  assert.equal(searchQuery("  pet   sim "), "pet sim");
  assert.equal(searchQuery(5), null);
  assert.equal(likePattern("50%_off,(x)"), "%50\\%\\_off  x %");
  assert.match(snippet("a ".repeat(100) + "heartbeat here " + "b ".repeat(100), "heartbeat"), /^….*heartbeat.*…$/);
  assert.equal(snippet("see [m:abc] heartbeat", "heartbeat").includes("[m:"), false);
  assert.deepEqual(titleHits([{ title: "Pet sim lag" }, { title: "Shorts" }], "sim pet").map((c) => c.title), ["Pet sim lag"]);
});

test("wantsPhotoText: OCR a photo only when he asks for its words", () => {
  assert.equal(wantsPhotoText("read this receipt"), true);
  assert.equal(wantsPhotoText("loe see tekst"), true);
  assert.equal(wantsPhotoText("what breed is this dog?"), false);
});

test("chatSwRoute: only the app shell and hashed build files are cached; every API call stays live", () => {
  assert.equal(chatSwRoute("GET", "/_next/static/chunks/a.js"), "static");
  assert.equal(chatSwRoute("GET", "/chat"), "shell");
  assert.equal(chatSwRoute("GET", "/api/core/chats"), null);
  assert.equal(chatSwRoute("POST", "/api/core"), null);
  assert.equal(chatSwRoute("GET", "/"), null);
});

test("the chat search and rewind stay plain SQL: no model or embedder import in the chats route", () => {
  const src = readFileSync(new URL("../src/app/api/core/chats/route.ts", import.meta.url), "utf8");
  const imports = src.split("\n").filter((l) => /^import /.test(l)).join("\n");
  assert.doesNotMatch(imports, /embed|ollama|anthropic|claude|haiku|rerank|local-brain|core"/i);
  assert.match(src, /case "rewind"/);
});
