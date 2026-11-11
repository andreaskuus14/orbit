import { test } from "node:test";
import assert from "node:assert/strict";
import { decideLoop, detectLoops, loopsLine, openLoops, promisesIn, type LoopSources } from "../src/lib/loops-pure.ts";

const now = Date.parse("2026-10-27T09:00:00Z"), today = "2026-10-27";
const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();
const base: LoopSources = { now, today };

test("promisesIn: remind me / I'll / I will, not filler", () => {
  assert.deepEqual(promisesIn("Remind me to call the bank. I'll send Mari the deck tomorrow! I'll see."), ["call the bank", "send Mari the deck tomorrow"]);
  assert.deepEqual(promisesIn("What's the weather?"), []);
});

test("each source raises its loop with evidence and a next step", () => {
  const loops = detectLoops({
    ...base,
    commitments: [
      { id: "c1", text: "send the quote", owner: "me", due: "2026-10-25", status: "confirmed", at: daysAgo(5) },
      { id: "c2", text: "Mari sends the photos", owner: "them", due: "2026-10-26", status: "confirmed", at: daysAgo(4) },
      { id: "c3", text: "fix the shop page", owner: "me", status: "awaiting", at: daysAgo(4) },
      { id: "c4", text: "later thing", owner: "me", due: "2026-11-30", status: "confirmed", at: daysAgo(4) }, // not due yet
    ],
    goals: [{ id: "g1", title: "1k subs", status: "running", updated_at: daysAgo(9) }, { id: "g2", title: "fresh", status: "running", updated_at: daysAgo(2) }, { id: "g3", title: "old done", status: "done", updated_at: daysAgo(40) }],
    missions: [{ id: "m1", objective: "Ship update", status: "waiting-input", updated_at: daysAgo(8) }, { id: "m2", objective: "x", status: "completed", updated_at: daysAgo(30) }],
    prospects: [
      { id: "p1", name: "Cafe A", stage: "contacted", updated_at: daysAgo(6), notes: "", draft: "" },
      { id: "p2", name: "Cafe B", stage: "contacted", updated_at: daysAgo(6), notes: "replied yes", draft: "" },
      { id: "p3", name: "Gym C", stage: "lead", updated_at: daysAgo(4), notes: "", draft: "Hello" },
    ],
    invoices: [{ id: "i1", number: "2026-1", buyer: { name: "Cafe A" }, status: "sent", due: "2026-10-20", reminder: { at: daysAgo(5) } }, { id: "i2", number: "2026-2", buyer: { name: "Z" }, status: "paid", due: "2026-10-01", reminder: null }],
    contracts: [{ id: "k1", title: "Pilot", status: "review", updatedAt: daysAgo(5), reviewAt: daysAgo(5) }, { id: "k2", title: "Deal", status: "sent", updatedAt: daysAgo(10), sent: { at: daysAgo(10) } }, { id: "k3", title: "New", status: "review", updatedAt: daysAgo(1) }],
    messages: [{ id: "x1", conversation_id: "conv1", content: "ok remind me to renew the domain", created_at: daysAgo(2) }, { id: "x2", conversation_id: "conv2", content: "I'll do the thumbnails", created_at: daysAgo(0) }],
  });
  const kinds = loops.map((l) => `${l.kind}:${l.title}`);
  for (const want of ["promise:You said you'd send the quote", "waiting:Still waiting: Mari sends the photos", "inbox:Unconfirmed: fix the shop page", "goal:Goal stalled: 1k subs", "mission:Mission stalled: Ship update",
    "prospect:Cafe A hasn't replied", "approval:Email to Gym C waits for your OK", "invoice:Invoice 2026-1 to Cafe A is overdue", "approval:Reminder for invoice 2026-1 waits for your OK",
    "contract:Contract unsigned: Pilot", "contract:No countersignature: Deal", "promise:You said you'd renew the domain"]) assert.ok(kinds.includes(want), want);
  assert.equal(loops.length, 12); // not: fresh goal, done goal, finished mission, replied prospect, paid invoice, new contract, today's chat, not-yet-due promise
  const chat = loops.find((l) => l.evidence.chat)!;
  assert.deepEqual(chat.evidence, { label: "CORE chat, 2 days ago", panel: "core", chat: "conv1" });
  assert.ok(loops.every((l) => l.next && l.evidence.label));
  assert.ok(loops.every((l, i) => i === 0 || Date.parse(loops[i - 1].since) <= Date.parse(l.since)), "oldest first");
});

test("dedupe: the same promise in chat and in the inbox is one loop", () => {
  const loops = detectLoops({ ...base,
    commitments: [{ id: "c1", text: "Send the quote", owner: "me", due: "2026-10-25", status: "confirmed", at: daysAgo(5) }],
    messages: [{ id: "x", conversation_id: "c", content: "I'll send the quote.", created_at: daysAgo(3) }, { id: "y", conversation_id: "d", content: "I'll send the quote!", created_at: daysAgo(2) }] });
  assert.equal(loops.length, 1);
});

test("closed and task loops never come back; snooze hides until its day", () => {
  const found = detectLoops({ ...base, goals: [{ id: "g1", title: "A", status: "running", updated_at: daysAgo(9) }, { id: "g2", title: "B", status: "running", updated_at: daysAgo(8) }, { id: "g3", title: "C", status: "running", updated_at: daysAgo(7) }] });
  const [a, b, c] = found.map((l) => l.key);
  const close = decideLoop(found, a, "close", now, today), snooze = decideLoop(found, b, "snooze", now, today), task = decideLoop(found, c, "task", now, today);
  assert.ok(typeof close !== "string" && typeof snooze !== "string" && typeof task !== "string");
  assert.equal(snooze.until, "2026-10-30");
  const decided = { [a]: close, [b]: snooze, [c]: task };
  assert.deepEqual(openLoops(found, decided, today), []);
  assert.deepEqual(openLoops(found, decided, "2026-10-30").map((l) => l.key), [b]);
  assert.deepEqual(openLoops(found, decided, "2027-06-01").map((l) => l.key), [b]); // closed stays closed for good
  // a goal that moved and stalled again is a new loop
  const again = detectLoops({ ...base, now: now + 20 * 86_400_000, goals: [{ id: "g1", title: "A", status: "running", updated_at: daysAgo(-10) }] });
  assert.equal(openLoops(again, decided, "2026-11-16").length, 1);
});

test("decideLoop validates; loopsLine is one line", () => {
  const found = detectLoops({ ...base, goals: [{ id: "g1", title: "A", status: "running", updated_at: daysAgo(9) }] });
  assert.equal(decideLoop(found, "nope", "close", now, today), "No such open loop");
  assert.equal(decideLoop(found, found[0].key, "delete", now, today), "action must be close, snooze or task");
  assert.equal(loopsLine([]), "");
  assert.equal(loopsLine(found), "1 open loop, oldest: Goal stalled: A");
});

test("loopOrigin: Turn into task keeps the loop's source kind; LIFE stays life, unknown stays loop", async () => {
  const { loopOrigin } = await import("../src/lib/loops-pure.ts");
  const ev = { label: "x", panel: "life" as const };
  const l = (kind: string, origin?: string) => ({ key: "k", kind, title: "t", next: "n", since: "2026-11-01", evidence: ev, ...(origin && { origin }) }) as Parameters<typeof loopOrigin>[0];
  assert.equal(loopOrigin(l("promise", "life")), "life");
  assert.equal(loopOrigin(l("promise", "chat")), "chat");
  assert.equal(loopOrigin(l("prospect")), "business");
  assert.equal(loopOrigin(l("inbox")), "loop");
  const found = detectLoops({ now: Date.parse("2026-11-10T12:00:00Z"), today: "2026-11-10", commitments: [{ id: "c1", text: "Write essay", owner: "me", due: "2026-11-01", status: "confirmed", at: "2026-10-30T00:00:00Z", source: { kind: "life" } }] } as LoopSources);
  assert.equal(found[0] && loopOrigin(found[0]), "life");
});
