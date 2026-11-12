import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { decide, TIERS, type PolicyCtx, type AllowOnceHook } from "../src/lib/policy-pure.ts";
import { allowOnceBook, ALLOW_ONCE_MS, egressKey } from "../src/lib/allow-once-pure.ts";
import { phraseHashes, hashLeak } from "../src/lib/phrase-hash-pure.ts";
import { mergeTaint, parseTaint } from "../src/lib/durable-pure.ts";

process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-allow-once-"));
const { coreTaintStore } = await import("../src/lib/durable.ts");
const G = globalThis as unknown as { __orbitDurable: { taint?: unknown; chain: Promise<unknown> } };
const restart = async () => { await G.__orbitDurable.chain; G.__orbitDurable.taint = undefined; };

const JOURNAL = "Today I felt anxious about the move and argued with my sister about the old flat again before dinner";
const LOCAL = "meeting notes from the shared drive folder about the spring garden layout plan";
const SAVE = "plugin__notes__save", SEND = "plugin__mail__send";
const plugins: PolicyCtx["plugins"] = { [SAVE]: { mode: "auto", tier: "T2", local: true }, [SEND]: { mode: "auto", tier: "T2", local: false } };
const base: PolicyCtx = { stopAll: false, attach: false, pins: false, steps: [], question: "save that", plugins };

test("phrase hashes find a copied phrase but not his own words or unrelated text", () => {
  const h = phraseHashes([JOURNAL]);
  assert.ok(h.every((x) => /^[0-9a-f]{16}$/.test(x)));
  assert.equal(hashLeak("note: argued with my sister about the old flat", h), "argued with my sister");
  assert.equal(hashLeak("argued with my sister", h, "write argued with my sister"), "");
  assert.equal(hashLeak("buy milk and eggs tomorrow morning", h), "");
});

test("journal prose read → restart → local plugin save refused; local-only chat → restart → local→local allowed", async () => {
  coreTaintStore.mark("chat-j", { kind: "private", p: phraseHashes([JOURNAL]), l: [] });
  coreTaintStore.mark("chat-l", { kind: "local", p: [], l: phraseHashes([LOCAL]) });
  await restart();
  const j = coreTaintStore.get("chat-j")!, l = coreTaintStore.get("chat-l")!;
  assert.equal(j.kind, "private"); assert.equal(l.kind, "local");
  assert.ok(!JSON.stringify(await readFile(path.join(process.env.ORBIT_DATA_DIR!, "core-taint.json"), "utf8")).includes("sister")); // hashes only on disk
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
  assert.equal(decide("web_search", { query: "weather tallinn" }, ctx).allow, false);
});

const hook = (b: ReturnType<typeof allowOnceBook>, chat: string, now: () => number): AllowOnceHook => ({
  has: (t, i) => b.has(t, i, chat, now()), take: (t, i) => b.take(t, i, chat, now()), offer: (t, i) => ({ id: b.offer(t, i, chat, true, now()), journal: true }),
});

test("allow once: exactly that call once; other args/target, replay, expired, other chat refused", () => {
  const b = allowOnceBook(); let t = 1_000;
  const ctx: PolicyCtx = { ...base, carried: true, carriedKind: "private", carriedHashes: phraseHashes([JOURNAL]), allowOnce: hook(b, "c1", () => t) };
  const input = { text: JOURNAL };
  const r = decide(SAVE, input, ctx);
  assert.equal(r.allow, false); assert.ok(r.allowOnce?.id); assert.equal(r.allowOnce.journal, true);
  assert.deepEqual(b.grant(r.allowOnce.id, t), { tool: SAVE, journal: true });
  assert.equal(b.grant(r.allowOnce.id, t), null); // a card's id grants once
  assert.equal(decide(SAVE, { text: JOURNAL + " more" }, ctx).allow, false); // different args
  assert.equal(decide(SEND, input, { ...ctx, plugins }).allow, false); // different target
  assert.equal(decide(SAVE, input, { ...ctx, allowOnce: hook(b, "c2", () => t) }).allow, false); // other chat
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

test("allow once still runs every other check (Stop-all)", () => {
  const b = allowOnceBook();
  const ctx: PolicyCtx = { ...base, carried: true, carriedKind: "private", carriedHashes: phraseHashes([JOURNAL]), allowOnce: hook(b, "c", () => 1) };
  b.grant(decide(SAVE, { text: JOURNAL }, ctx).allowOnce!.id, 1);
  assert.equal(decide(SAVE, { text: JOURNAL }, { ...ctx, stopAll: true }).allow, false);
});

test("no model or background path to a grant", async () => {
  assert.ok(!Object.keys(TIERS).some((t) => /allow/i.test(t)));
  assert.equal(decide("allow_once", {}, base).allow, false);
  const src = (f: string) => readFile(new URL(`../src/${f}`, import.meta.url), "utf8");
  assert.ok(!/allowOnce\.grant\(/.test(await src("lib/core.ts"))); // only the requireUser route grants
  const route = await src("app/api/core/allow-once/route.ts");
  assert.match(route, /requireUser\(\)/); assert.match(route, /allowOnce\.grant\(/);
  assert.match(await src("lib/core.ts"), /budget\.background \? ""/); // hook off in background turns
});
