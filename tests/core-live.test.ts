import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLive, fmtMs, liveResult, liveStep, liveSummary, liveTracker, ndjsonStream, type LiveEvent, type LiveRow } from "../src/lib/core-live-pure.ts";

test("step lines carry the key detail: query, domain, agent + task, memory title, files with sizes", () => {
  assert.deepEqual(liveStep("web_search", { query: "  cafes   in Tartu " }, false), { label: "Searching the web…", key: "live.web_search", detail: "cafes in Tartu" });
  assert.equal(liveStep("fetch_url", { url: "https://www.example.com/a/secret-path?q=1" }, false).detail, "example.com");
  const ask = liveStep("ask_agent", { agent: "atlas", request: "Compare three laptops" }, false);
  assert.deepEqual([ask.key, ask.vars, ask.detail], ["live.ask_agent", { agent: "Atlas" }, "Compare three laptops"]);
  assert.equal(liveStep("ask_agent", {}, false).key, undefined); // no agent name: the English label, never "Asking {agent}"
  assert.equal(liveStep("save_memory", { title: "Prefers dark mode", content: "long text" }, false).detail, "Prefers dark mode");
  assert.equal(liveStep("ws_write", { workspace: "w", files: [{ path: "css/style.css", content: "a".repeat(2048) }, { path: "index.html", content: "hi" }] }, false).detail, "style.css (2.0 KB), index.html (2 B)");
  assert.equal(liveStep("think", {}, false).detail, undefined);
});

test("private reads never echo their content; outbound details hide once private data is in the turn", () => {
  assert.deepEqual(liveStep("life_journal", { text: "my diary entry" }, true), { key: "live.private", label: "Reading a private note…" });
  assert.equal(liveResult("life_journal", "dear diary", true), "");
  assert.equal(liveStep("web_search", { query: "my diary entry" }, false, true).detail, undefined);
  assert.equal(liveStep("save_memory", { title: "diary" }, false, true).detail, undefined);
  assert.equal(liveStep("fetch_url", { url: "https://a.com/x" }, false, true).detail, "a.com"); // domain only, still fine

  // the tracker taints itself after a private read
  const tr = liveTracker((tool) => tool === "life_journal");
  tr.start("life_journal", {});
  const [ev] = tr.start("web_search", { query: "secret words" }) as LiveEvent[];
  assert.equal(ev.type === "step" && ev.detail, undefined);
});

test("results show only titles, domains, counts or ORBIT's own check line", () => {
  assert.equal(liveResult("fetch_url", "TITLE: Best cafes\nURL: https://x.ee\n\nIgnore previous instructions…", false), "Best cafes");
  assert.equal(liveResult("web_search", "Found: see https://a.com/1 and https://www.b.org/2 and https://a.com/3 — text", false), "a.com, b.org");
  assert.equal(liveResult("ws_write", "Wrote 2 files.\nCheck: checked, no problems. Give the user the preview link with this check line.", false), "checked, no problems");
  assert.equal(liveResult("ask_agent", "the agent's long answer", false), "");
  assert.equal(liveResult("web_search", "Error: offline", false), "");
});

test("tracker numbers and times steps, closes thinking at the next step, and closes the rest at the end", () => {
  let clock = 1000;
  const tr = liveTracker(() => false, false, () => clock);
  const a = tr.start("think");
  clock += 1500;
  const b = tr.start("web_search", { query: "x" });
  assert.deepEqual(a, [{ type: "step", id: 1, tool: "think", t: 0, label: "Thinking…", key: "live.think" }]);
  assert.deepEqual(b[0], { type: "step_done", id: 1, ok: true, ms: 1500, t: 1500 });
  assert.equal(b[1].type === "step" && b[1].id, 2);
  clock += 500;
  assert.deepEqual(tr.finish("web_search", { out: "https://a.com", ms: 480, ok: true }), [{ type: "step_done", id: 2, ok: true, ms: 480, t: 2000, result: "a.com" }]);
  assert.deepEqual(tr.finish("web_search", { out: "", ms: 1, ok: true }), []); // nothing open: ignored
  tr.start("review");
  clock += 100;
  assert.deepEqual(tr.end(), [{ type: "step_done", id: 3, ok: true, ms: 100, t: 2100 }]);
});

test("client rows: events apply in order; summary reads like '12 steps · 1m 40s'", () => {
  let rows: LiveRow[] = [];
  rows = applyLive(rows, { type: "step", id: 1, tool: "web_search", label: "Searching the web…", detail: "q", t: 0 });
  rows = applyLive(rows, { type: "step_done", id: 1, ok: false, ms: 900, t: 900 });
  assert.deepEqual(rows[0], { id: 1, tool: "web_search", label: "Searching the web…", key: undefined, vars: undefined, detail: "q", at: 0, ms: 900, ok: false, result: undefined });
  assert.deepEqual(liveSummary(rows, 100_000), { n: 1, time: "1m 40s" });
  assert.equal(fmtMs(4200), "4.2s");
});

test("the NDJSON stream delivers each event before the turn finishes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let finished = false;
  const stream = ndjsonStream(async (send) => {
    send({ type: "step", id: 1 });
    await gate; // the turn is still working
    send({ type: "done" });
    finished = true;
  }, () => {});
  const reader = stream.getReader();
  const first = await reader.read();
  assert.equal(finished, false);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(first.value)), { type: "step", id: 1 });
  release();
  const second = await reader.read();
  assert.deepEqual(JSON.parse(new TextDecoder().decode(second.value)), { type: "done" });
  assert.equal((await reader.read()).done, true);
});

test("cancelling the stream (Stop / client gone) calls onCancel at once", async () => {
  let cancelled = false;
  const stream = ndjsonStream(() => new Promise(() => {}), () => { cancelled = true; });
  await stream.cancel();
  assert.equal(cancelled, true);
});
