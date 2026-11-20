// Property-based tests (fast-check, MIT) for ORBIT's meters: the Claude usage meter + pacer, the YouTube quota ledger and the GPU lease.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { D7, H5, MAX_CALLS, MAX_RESET_MS, addCall, emptyMeter, parseLimitError, usageLevel, windowStats, type Call } from "../src/lib/usage-meter-pure.ts";
import { MAX_FRESH_LEAD_MIN, inFreshWindow, paceHold } from "../src/lib/usage-pace-pure.ts";
import { SHARES, account, quotaLeft, today, totalUnits, weightedCost, type QuotaGroup, type QuotaLedger } from "../src/lib/youtube-quota-pure.ts";
import { beat, drop, emptyGpu, enqueue, tick, type GpuKind, type GpuState } from "../src/lib/gpu-lock-pure.ts";

const T0 = Date.parse("2026-01-14T12:00:00Z"); // winter: Tallinn is a steady UTC+2 all day

// ---- usage meter ----

const call = (at: number, tok: number): Call => ({ at, purpose: "agent.x", model: "m", inTok: tok, outTok: 0, ms: 1, ok: true, cost: 0.01 });

test("usage meter: a window counts exactly the calls inside it, more time never adds calls, and the 7-day trim keeps only fresh ones", () => {
  fc.assert(fc.property(fc.array(fc.record({ ago: fc.integer({ min: -60_000, max: 9 * 86_400_000 }), tok: fc.nat(10_000) }), { maxLength: 60 }), fc.integer({ min: 1, max: D7 }), (cs, span) => {
    const calls = cs.map((c) => call(T0 - c.ago, c.tok));
    const w = windowStats(calls, T0, span), inside = calls.filter((c) => c.at <= T0 && T0 - c.at < span);
    assert.equal(w.calls, inside.length);
    assert.equal(w.tokens, inside.reduce((a, c) => a + c.inTok + c.outTok, 0));
    assert.equal(Object.values(w.byPurpose).reduce((a, p) => a + p.calls, 0), w.calls, "per-purpose counts add up");
    assert.ok(windowStats(calls, T0, Math.min(D7, span * 2)).calls >= w.calls, "a longer window never has fewer calls");
    const m = emptyMeter();
    for (const c of calls) addCall(m, c, T0);
    assert.ok(m.calls.length <= MAX_CALLS && m.calls.every((c) => T0 - c.at < D7));
  }), { numRuns: 2000 });
});

test("usage level never goes down when a call is added, and heavy means at or past his warning share", () => {
  fc.assert(fc.property(fc.array(fc.nat(H5 - 1), { maxLength: 40 }), fc.integer({ min: 5, max: 500 }), fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 10, max: 100 }), (agos, calls5h, tokens5h, warnPct) => {
    const m = { ...emptyMeter(), settings: { calls5h, tokens5h, warnPct } };
    m.calls = agos.map((a) => call(T0 - a, 500));
    const before = usageLevel(m, T0);
    m.calls.push(call(T0, 500));
    const after = usageLevel(m, T0);
    assert.ok(after.pct >= before.pct && before.pct >= 0);
    if (after.heavy) assert.ok(after.pct >= warnPct - 1);
  }), { numRuns: 2000 });
});

test("a parsed rate-limit pause is never in the past and never longer than 8 days, whatever the error text says", () => {
  const texts = fc.oneof(
    fc.integer({ min: 0, max: 4_000_000_000_000 }).map((n) => `Claude AI usage limit reached|${n}`),
    fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 70 }), fc.constantFrom("am", "pm", ""), fc.constantFrom("", "mon ", "Sat ")).map(([h, m, ap, d]) => `5-hour limit reached ∙ resets ${d}${h}:${String(m).padStart(2, "0")}${ap}`),
    fc.constant("API Error: 429 rate_limit_error"), fc.string());
  fc.assert(fc.property(texts, fc.integer({ min: 0, max: 4_000_000_000_000 }), (t, now) => {
    const u = parseLimitError(t, now);
    if (u === null) return;
    assert.ok(u >= now + 60_000 && u <= now + MAX_RESET_MS, `${t} → ${u - now} ms`);
  }), { numRuns: 3000 });
});

test("pacer: the pre-morning fresh window is exactly `lead` minutes a day and ends at his morning time", () => {
  const hm = fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })).map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  fc.assert(fc.property(hm, fc.integer({ min: 0, max: MAX_FRESH_LEAD_MIN }), (morning, lead) => {
    const day = Date.parse("2026-01-14T00:00:00+02:00");
    let inside = 0;
    for (let k = 0; k < 1440; k++) if (inFreshWindow(day + k * 60_000 + 30_000, morning, lead)) inside++;
    assert.equal(inside, lead);
    const [h, m] = morning.split(":").map(Number), at = day + (h * 60 + m) * 60_000;
    assert.equal(inFreshWindow(at + 30_000, morning, lead), false, "his morning minute itself is free");
    if (lead) assert.equal(inFreshWindow(at - 30_000, morning, lead), true, "the minute before it is held");
    if (lead) assert.equal(paceHold({ now: at - 30_000, pct: 0, morningAt: morning, freshLeadMin: lead })?.kind, "fresh");
  }), { numRuns: 10, examples: [["07:30", 120], ["00:30", 120], ["06:00", 360], ["23:59", 1]] });
});

// ---- YouTube quota ----

const GROUPS = Object.keys(SHARES) as QuotaGroup[];
const ENDPOINTS = ["search", "videos.update", "videos.list", "analytics", "channels.list"];

test("YouTube quota (fast-check counterexample: 'trend-radar' as niche then herald, budget 667): with the charge-only-if-left rule, no share, the 80 % background cap or the daily budget is ever overspent", () => {
  const op = fc.record({ caller: fc.constantFrom("scout", "niche", "trend-radar", "herald-niche", "outliers", "doctor"), group: fc.constantFrom(...GROUPS), endpoint: fc.constantFrom(...ENDPOINTS) });
  fc.assert(fc.property(fc.array(op, { maxLength: 120 }), fc.integer({ min: 200, max: 9000 }), (ops, budget) => {
    let l: QuotaLedger = { v: 1, days: [] };
    const spent: Record<string, number> = {};
    for (const o of ops) {
      const cost = weightedCost(o.endpoint);
      if (cost && quotaLeft(today(l, T0), o.group, budget) < cost) continue; // meterYoutube refuses
      l = account(l, o.caller, o.group, o.endpoint, T0);
      spent[o.group] = (spent[o.group] ?? 0) + cost;
    }
    const d = today(l, T0), byGroup = (g: string) => Object.values(d.callers).filter((c) => c.group === g).reduce((a, c) => a + c.units, 0);
    for (const g of GROUPS) {
      assert.equal(byGroup(g), spent[g] ?? 0, `the ledger books ${g}'s units to ${g}`);
      assert.ok(byGroup(g) <= Math.floor(budget * SHARES[g]), `${g} ${byGroup(g)} > its share`);
      assert.ok(quotaLeft(d, g, budget) >= 0);
    }
    assert.ok(GROUPS.filter((g) => g !== "manual").reduce((a, g) => a + byGroup(g), 0) <= Math.floor(budget * 0.8));
    assert.ok(totalUnits(d) <= budget);
  }), { numRuns: 1000 });
});

test("regression: one caller used by two groups ('trend-radar' from STUDIO manual and the Shorts planner's scout) moved scout's units to manual", () => {
  let l: QuotaLedger = { v: 1, days: [] };
  l = account(l, "trend-radar", "scout", "search", T0);
  l = account(l, "trend-radar", "manual", "videos.list", T0);
  const d = today(l, T0);
  assert.equal(quotaLeft(d, "scout", 4000), 1000 - 100, "scout still owns its search");
  assert.equal(quotaLeft(d, "manual", 4000), 800 - 1);
  assert.equal(totalUnits(d), 101);
});

// ---- GPU lease ----

const KINDS: GpuKind[] = ["image", "3d", "render", "video", "music", "transcribe", "ocr"];

test("GPU lease: never more holders than slots, strict first-come order, no expired lease or timed-out waiter survives a tick", () => {
  const op = fc.oneof(
    fc.record({ t: fc.constant("join" as const), kind: fc.constantFrom(...KINDS), wait: fc.integer({ min: 1, max: 60_000 }), ttl: fc.integer({ min: 1, max: 60_000 }) }),
    fc.record({ t: fc.constant("tick" as const), dt: fc.integer({ min: 0, max: 30_000 }) }),
    fc.record({ t: fc.constant("beat" as const), k: fc.nat(50) }),
    fc.record({ t: fc.constant("drop" as const), k: fc.nat(50) }));
  fc.assert(fc.property(fc.integer({ min: 1, max: 4 }), fc.array(op, { maxLength: 80 }), (slots, ops) => {
    let s: GpuState = emptyGpu(slots), now = T0, n = 0;
    const joined: string[] = [], granted: string[] = [];
    for (const o of ops) {
      if (o.t === "join") { const id = `j${n++}`; joined.push(id); s = enqueue(s, { id, kind: o.kind, since: now, deadline: now + o.wait, ttl: o.ttl }); continue; }
      if (o.t === "beat" && joined.length) { s = beat(s, joined[o.k % joined.length], now); continue; }
      if (o.t === "drop" && joined.length) { s = drop(s, joined[o.k % joined.length]); continue; }
      if (o.t !== "tick") continue;
      now += o.dt;
      const waitingBefore = s.queue.filter((w) => w.deadline > now).map((w) => w.id);
      const r = tick(s, now);
      s = r.state;
      assert.ok(s.holders.length <= slots, "never more jobs on the GPU than slots");
      assert.deepEqual(r.granted, waitingBefore.slice(0, r.granted.length), "granted in the order they joined");
      assert.ok(s.holders.every((h) => h.until > now) && s.queue.every((w) => w.deadline > now));
      assert.ok(!s.queue.length || s.holders.length === slots, "nobody waits while a slot is free");
      const ids = [...s.holders.map((h) => h.id), ...s.queue.map((w) => w.id)];
      assert.equal(new Set(ids).size, ids.length, "a job is never both holding and waiting, or there twice");
      granted.push(...r.granted);
    }
    assert.equal(new Set(granted).size, granted.length, "a job is granted the GPU once");
  }), { numRuns: 2000 });
});
