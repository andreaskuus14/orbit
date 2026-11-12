import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { decide, policyEvent, TIERS, NO_MODEL_ONCE, EGRESS_CLASS, LINK_TOOLS, LEAK_TOOLS, type PolicyCtx, type AllowOnceHook } from "../src/lib/policy-pure.ts";
import { allowOnceBook, ALLOW_ONCE_MS, egressKey, visible } from "../src/lib/allow-once-pure.ts";
import { phraseHashes, hashLeak } from "../src/lib/phrase-hash-pure.ts";
import { mergeTaint, parseTaint } from "../src/lib/durable-pure.ts";

process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-allow-once-"));
const { coreTaintStore, hashKey } = await import("../src/lib/durable.ts");
const G = globalThis as unknown as { __orbitDurable: { taint?: unknown; chain: Promise<unknown> } };
const restart = async () => { await G.__orbitDurable.chain; G.__orbitDurable.taint = undefined; };
const KEY = hashKey();

const JOURNAL = "Today I felt anxious about the move and argued with my sister about the old flat again before dinner";
const LOCAL = "meeting notes from the shared drive folder about the spring garden layout plan";
const SAVE = "plugin__notes__save", SEND = "plugin__mail__send";
const plugins: PolicyCtx["plugins"] = { [SAVE]: { mode: "auto", tier: "T2", local: true }, [SEND]: { mode: "auto", tier: "T2", local: false } };
const base: PolicyCtx = { stopAll: false, attach: false, pins: false, steps: [], question: "save that", plugins, hashKey: KEY };

test("HMAC phrase hashes: per-install key (0600), copied phrase found, his own words and other keys not", async () => {
  const st = await stat(path.join(process.env.ORBIT_DATA_DIR!, "taint-hash.key"));
  assert.equal(st.mode & 0o777, 0o600); assert.equal(KEY.length, 32);
  const h = phraseHashes([JOURNAL], KEY);
  assert.ok(h.every((x) => /^[0-9a-f]{16}$/.test(x)));
  assert.equal(hashLeak("note: argued with my sister about the old flat", h, KEY), "argued with my sister");
  assert.equal(hashLeak("argued with my sister", h, KEY, "write argued with my sister"), "");
  assert.equal(hashLeak("argued with my sister about", h, "other key"), "");
  assert.equal(hashLeak("buy milk and eggs tomorrow morning", h, KEY), "");
});

test("journal prose read → restart → local plugin save refused; local-only chat → restart → local→local allowed", async () => {
  coreTaintStore.mark("chat-j", { kind: "private", p: phraseHashes([JOURNAL], KEY), l: [] });
  coreTaintStore.mark("chat-l", { kind: "local", p: [], l: phraseHashes([LOCAL], KEY) });
  await restart();
  const j = coreTaintStore.get("chat-j")!, l = coreTaintStore.get("chat-l")!;
  assert.equal(j.kind, "private"); assert.equal(l.kind, "local");
  assert.ok(!(await readFile(path.join(process.env.ORBIT_DATA_DIR!, "core-taint.json"), "utf8")).includes("sister")); // hashes only on disk
  const ctx = (e: typeof j): PolicyCtx => ({ ...base, carried: true, carriedKind: e.kind ?? "unknown", carriedHashes: e.p, carriedLocalHashes: e.l });
  const jd = decide(SAVE, { text: JOURNAL }, ctx(j));
  assert.equal(jd.allow, false); assert.equal(jd.egress, true);
  assert.equal(decide(SAVE, { text: "a new shopping list" }, ctx(j)).allow, true);
  assert.equal(decide(SAVE, { text: LOCAL }, ctx(l)).allow, true); // local → local
  assert.equal(decide(SEND, { body: LOCAL }, ctx(l)).allow, false); // local → remote
  assert.equal(decide("web_search", { query: "argued with my sister about the old flat" }, ctx(j)).allow, false);
});

test("unknown taint kind (older file) fails closed for plugins and outbound tools", () => {
  assert.equal(parseTaint({ c: { id: "private", at: 1 } }).c.kind, undefined);
  assert.equal(mergeTaint({ id: "private", at: 1 }, { kind: "local", p: [], l: [] }, 2).kind, undefined); // stays unknown
  assert.equal(mergeTaint({ id: "private", at: 1, kind: "local" }, { kind: "private", p: [], l: [] }, 2).kind, "private");
  const ctx: PolicyCtx = { ...base, carried: true, carriedKind: "unknown" };
  assert.equal(decide(SAVE, { text: "hello" }, ctx).allow, false);
  const w = decide("web_search", { query: "weather tallinn" }, ctx);
  assert.equal(w.allow, false); assert.ok(w.reason.includes(NO_MODEL_ONCE) && !/Allow once on/.test(w.reason)); // no contradiction
});

const hook = (b: ReturnType<typeof allowOnceBook>, chat: string, now: () => number): AllowOnceHook => ({
  has: (t, i) => b.has(t, i, chat, now()), take: (t, i) => !!b.take(t, i, chat, now()), offer: (t, i, journal) => ({ id: b.offer(t, i, chat, journal, now()), journal }),
});
const jctx = (b: ReturnType<typeof allowOnceBook>, chat = "c1", now = () => 1_000): PolicyCtx =>
  ({ ...base, carried: true, carriedKind: "private", carriedHashes: phraseHashes([JOURNAL], KEY), allowOnce: hook(b, chat, now) });

test("allow once: exactly that call once; other args/target, replay, expired, other chat refused", () => {
  const b = allowOnceBook(); let t = 1_000;
  const ctx = jctx(b, "c1", () => t), input = { text: JOURNAL };
  const r = decide(SAVE, input, ctx);
  assert.equal(r.allow, false); assert.ok(r.allowOnce?.id); assert.equal(r.allowOnce.journal, true);
  assert.deepEqual(b.grant(r.allowOnce.id, t), { tool: SAVE, journal: true });
  assert.equal(b.grant(r.allowOnce.id, t), null); // a card's id grants once
  assert.equal(decide(SAVE, { text: JOURNAL + " more" }, ctx).allow, false); // different args
  assert.equal(decide(SEND, input, ctx).allow, false); // different target
  assert.equal(decide(SAVE, input, jctx(b, "c2", () => t)).allow, false); // other chat
  assert.equal(decide(SAVE, input, { ...ctx, allowOnce: undefined }).allow, false); // no hook (background, scheduler, Auto)
  const ok = decide(SAVE, { text: JOURNAL }, ctx);
  assert.equal(ok.allow, true); assert.match(ok.reason, /allowed once/);
  assert.equal(decide(SAVE, input, ctx).allow, false); // replay
  const r2 = decide(SAVE, input, ctx); b.grant(r2.allowOnce!.id, t);
  t += ALLOW_ONCE_MS + 1;
  assert.equal(decide(SAVE, input, ctx).allow, false); // expired
  const r3 = decide(SAVE, input, ctx); t += ALLOW_ONCE_MS + 1;
  assert.equal(b.grant(r3.allowOnce!.id, t), null); // an offer expires too
  assert.equal(egressKey("x", { a: 1, b: 2 }), egressKey("x", { b: 2, a: 1 }));
});

test("the card shows exactly the stored input; two offers of one tool show different args and grants don't cross", () => {
  const b = allowOnceBook(), ctx = jctx(b);
  const a = { to: "mari@example.com", text: JOURNAL }, c = { to: "jaan@example.com", text: `${JOURNAL} and more` };
  const ra = decide(SEND, a, ctx), rc = decide(SEND, c, ctx);
  const va = b.view(ra.allowOnce!.id, 1_000)!, vc = b.view(rc.allowOnce!.id, 1_000)!;
  assert.equal(va.tool, SEND); assert.match(va.destination, /plugin mail \(send\).*to: mari@example\.com/);
  assert.equal(va.args, JSON.stringify({ text: JOURNAL, to: "mari@example.com" }, null, 2)); // sorted keys, full text
  assert.notEqual(va.args, vc.args); assert.match(vc.destination, /jaan@/);
  b.grant(ra.allowOnce!.id, 1_000);
  assert.equal(decide(SEND, c, ctx).allow, false); // grant for a doesn't cover c
  assert.equal(decide(SEND, a, ctx).allow, true);
});

test("a grant that vanishes between has() and take() refuses; other checks still run (Stop-all)", () => {
  const b = allowOnceBook(), ctx = jctx(b);
  b.grant(decide(SAVE, { text: JOURNAL }, ctx).allowOnce!.id, 1_000);
  assert.equal(decide(SAVE, { text: JOURNAL }, { ...ctx, allowOnce: { ...ctx.allowOnce!, take: () => false } }).allow, false);
  assert.equal(decide(SAVE, { text: JOURNAL }, { ...ctx, stopAll: true }).allow, false);
});

test("private text to any model-bound tool is a hard refusal (no card), journal or local-plugin; non-model destinations keep Allow once", () => {
  const b = allowOnceBook();
  const lctx: PolicyCtx = { ...base, carried: true, carriedKind: "local", carriedLocalHashes: phraseHashes([LOCAL], KEY), allowOnce: hook(b, "c1", () => 1_000) };
  for (const ctx of [jctx(b), lctx]) {
    const text = ctx === lctx ? "meeting notes from the shared drive folder" : "argued with my sister about the old flat";
    for (const tool of ["web_search", "ask_agent", "local_tts", "local_image", "ws_picture_draft", "ws_inspire_image"]) {
      const d = decide(tool, { query: text, task: text, text, brief: text, prompt: text, agent: "atlas", workspace: "site" }, { ...ctx, question: "go" });
      assert.equal(d.allow, false, tool); assert.equal(d.allowOnce, undefined, tool);
      assert.equal(d.egress, false, tool); assert.ok(d.reason.includes(NO_MODEL_ONCE), tool);
    }
  }
  const d = decide(SEND, { body: LOCAL }, lctx); // local-plugin text to a remote plugin (not a model): card
  assert.ok(d.allowOnce?.id); assert.equal(d.allowOnce.journal, true);
  b.grant(d.allowOnce.id, 1_000);
  assert.equal(decide(SEND, { body: LOCAL }, lctx).allow, true);
  const att = decide(SEND, { body: "write to mari@example.com" }, { ...base, attach: true, allowOnce: hook(b, "c1", () => 1_000) });
  assert.equal(att.allowOnce?.journal, true); // first-turn attachment: warned
});

test("every CORE tool is classified model, web or none: a new tool can't be added unclassified", () => {
  for (const t of [...LINK_TOOLS, ...LEAK_TOOLS, ...Object.keys(TIERS)]) assert.ok(EGRESS_CLASS[t], t);
  for (const t of ["ask_agent", "web_search", "local_tts", "local_image", "ws_picture_draft", "ws_inspire_image", "read_news", "find_outliers",
    "start_mission", "queue_tonight", "higgsfield_draft", "automation_create", "create_goal", "propose_rule", "save_memory", "lead_create"]) assert.equal(EGRESS_CLASS[t], "model", t);
});

// Tools that hand model-chosen text to a model now or via a stored background record: journal text ⇒ hard refusal; clean chat ⇒ runs.
const BG: [string, string, Record<string, unknown>][] = [
  ["start_mission", "start a mission about it", { objective: "X", steps: [{ agent: "atlas", request: "X" }] }],
  ["queue_tonight", "look into it tonight", { text: "X" }],
  ["higgsfield_draft", "make 2 images of it", { prompt: "X", count: 2 }],
  ["automation_create", "create an automation every day at 8:00 that does it", { name: "daily", prompt: "X", when: "day", time: "08:00" }],
];
test("background-work tools: journal text in the chat ⇒ refused without a card; clean chat ⇒ allowed; nothing private is stored", () => {
  const b = allowOnceBook(), J = "argued with my sister about the old flat", C = "fox photos in the snow";
  for (const [tool, question, raw] of BG) {
    const fill = (x: string) => JSON.parse(JSON.stringify(raw).replaceAll('"X"', JSON.stringify(x)));
    const d = decide(tool, fill(J), { ...jctx(b), question });
    assert.equal(d.allow, false, tool); assert.equal(d.allowOnce, undefined, tool); assert.ok(d.reason.includes(NO_MODEL_ONCE), tool);
    assert.equal(decide(tool, fill(C), { ...jctx(b), question }).allow, true, `${tool} generic text in a journal chat`);
    assert.equal(decide(tool, fill(J), { ...base, question }).allow, true, `${tool} clean chat`);
    assert.equal(decide(tool, fill(C), { ...base, carried: true, carriedKind: "unknown", question }).allow, false, `${tool} unknown taint`);
  }
});

test("card text: control, zero-width and bidi characters are shown, not applied", () => {
  assert.equal(visible("a\u202Eb\u200Bc\u0007d\ne"), "a⟦U+202E⟧b⟦U+200B⟧c⟦U+0007⟧d\ne");
  const b = allowOnceBook(), r = decide(SEND, { to: "x\u202E@evil.com", text: JOURNAL }, jctx(b));
  const v = b.view(r.allowOnce!.id, 1_000)!;
  assert.ok(v.destination.includes("⟦U+202E⟧") && !v.destination.includes("\u202E"));
});

test("key missing, empty or wrong length while hashes exist: fails closed, never regenerated", async () => {
  const f = path.join(process.env.ORBIT_DATA_DIR!, "taint-hash.key");
  await rm(f);
  assert.throws(() => hashKey(), /missing/); // chat-j holds hashes
  await writeFile(f, ""); assert.throws(() => hashKey(), /length/);
  await writeFile(f, KEY.subarray(0, 16)); assert.throws(() => hashKey(), /length/);
  // core.ts: no key → carried chat is "unknown" → a journal phrase to web_search is refused
  assert.equal(decide("web_search", { query: "argued with my sister about the old flat" }, { ...base, carried: true, carriedKind: "unknown" }).allow, false);
  await writeFile(f, KEY, { mode: 0o600 }); assert.ok(hashKey().equals(KEY));
});

test("unknown plugin tool: plain refusal, no card, and the ledger never gets the model's name", () => {
  const b = allowOnceBook();
  const d = decide("plugin__evil__exfil", { text: JOURNAL }, jctx(b));
  assert.equal(d.allow, false); assert.equal(d.allowOnce, undefined); assert.equal(d.egress, undefined);
  assert.equal(policyEvent("plugin__evil__exfil", d)?.tool, "unknown");
  assert.equal(policyEvent("made_up_tool", decide("made_up_tool", {}, base))?.tool, "unknown");
});

test("no model or background path to a grant", async () => {
  assert.ok(!Object.keys(TIERS).some((t) => /allow/i.test(t)));
  assert.equal(decide("allow_once", {}, base).allow, false);
  const src = (f: string) => readFile(new URL(`../src/${f}`, import.meta.url), "utf8");
  assert.ok(!/allowOnce\.grant\(/.test(await src("lib/core.ts"))); // only the requireUser route grants
  const route = await src("app/api/core/allow-once/route.ts");
  assert.equal(route.match(/requireUser\(\)/g)?.length, 2); assert.match(route, /allowOnce\.grant\(/);
  assert.match(await src("lib/core.ts"), /budget\.background \? ""/); // hook off in background turns
});
