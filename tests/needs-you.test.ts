import { test } from "node:test";
import assert from "node:assert/strict";
import { leadItems, morningPicks, needsYou, receiptOpen, recordRef, reuse, type NeedsIn } from "../src/lib/needs-you-pure.ts";
import { briefItems, type BriefIn } from "../src/lib/brief-pure.ts";
import type { Loop } from "../src/lib/loops-pure.ts";

const loop = (key: string, title = key): Loop => ({ key, kind: "approval", title, next: "Do it", since: "2026-10-20T00:00:00Z", evidence: { label: "x", panel: "business" } });
const file = [{ evidence: [{ kind: "file", id: "ws1", path: "out/report.md", bytes: 10 }] }];

test("recordRef: one record behind every source key", () => {
  assert.equal(recordRef("approval:prospect:p1:2026-10-20"), "prospect:p1");
  assert.equal(recordRef("send:p1"), "prospect:p1");
  assert.equal(recordRef("prospect:p1:2026-10-20"), "prospect:p1");
  assert.equal(recordRef("approval:invoice:i1:2026-10-20"), "invoice:i1");
  assert.equal(recordRef("mission:m1:2026-10-01"), "mission:m1");
  assert.equal(recordRef("contract:c1:review"), "contract:c1");
  assert.equal(recordRef("clip:job/clip"), "clip:job/clip");
});

test("the same approval is one Decide card, not also a loop or a second decision", () => {
  const x: NeedsIn = {
    approvals: [{ id: "h1", key: "send:p1", title: "Acme", detail: "BUSINESS email" }, { id: "h2", key: "invoice:i1", title: "Invoice 7" }],
    decisions: [{ id: "invoice:i1", title: "Reminder to Acme", what: "", open: { panel: "business" } }, { id: "task:t1", title: "Post draft", what: "", approve: { task: "t1" } }],
    loops: [loop("approval:prospect:p1:2026-10-20"), loop("approval:invoice:i1:2026-10-19"), loop("promise:call mom")],
    work: [{ kind: "task", id: "t1", title: "Post draft", status: "failed", detail: "", action: "" }],
  };
  const n = needsYou(x);
  assert.deepEqual(n.map((i) => [i.ref, i.kind]), [["prospect:p1", "decide"], ["invoice:i1", "decide"], ["task:t1", "decide"], ["promise:call mom", "unblock"]]);
  assert.equal(n[1].remote, "h2"); // the phone's card id survives
  assert.deepEqual(n[2].act, { open: { panel: "agents" } }); // never a one-tap approve: it opens where the content is
});

test("a more urgent kind replaces a less urgent one for the same record", () => {
  const n = needsYou({ night: { done: [{ label: "Goal: 2 steps done", open: { goal: "g1" } }], failed: [] }, decisions: [{ id: "goal:g1", title: "Goal step needs OK", what: "" }] });
  assert.deepEqual(n.map((i) => [i.ref, i.kind]), [["goal:g1", "decide"]]);
});

test("ordering: Decide, Unblock, Review (newest first); waiting-approval missions are not blockers", () => {
  const n = needsYou({
    tasks: [{ id: "a", title: "Old report", finished_at: "2026-10-27T01:00:00Z", pending: file }, { id: "b", title: "New report", finished_at: "2026-10-27T05:00:00Z", pending: file }, { id: "c", title: "No receipt", finished_at: "2026-10-27T06:00:00Z", pending: [] }],
    missions: [{ id: "m1", objective: "Launch", status: "waiting-input", blocker: "Need the price", updated_at: "x" }, { id: "m2", objective: "Wait", status: "waiting-approval", updated_at: "x" }],
    loops: [loop("mission:m1:2026-10-01")],
    trust: [{ kind: "save_memory", area: "memory", from: "ask", to: "do", approved: 12, total: 12, streak: 12 }],
    incident: { id: "i9", title: "Crash in CORE" },
  });
  assert.deepEqual(n.map((i) => i.ref), ["trust:memory", "health:i9", "mission:m1", "task:b", "task:a"]);
  assert.deepEqual(n[0].act, { open: { panel: "profile" } });
  assert.equal(n[2].detail, "Need the price");
});

test("empty sources → empty inbox and no lead lines", () => {
  assert.deepEqual(needsYou({}), []);
  assert.deepEqual(needsYou({ night: null, conflict: null, incident: null }), []);
  assert.deepEqual(leadItems(morningPicks([])), []);
});

test("receipts: only read-back evidence makes a result; files link, memories open", () => {
  assert.deepEqual(receiptOpen(file), { href: "/api/workspace?ws=ws1&file=out%2Freport.md&open=1" });
  assert.deepEqual(receiptOpen([{ evidence: [{ kind: "memory", id: "m1" }] }]), { memory: "m1" });
  assert.equal(receiptOpen([{ status: "done" }]), null);
  assert.equal(receiptOpen("junk"), null);
});

test("morning picks: one artifact with a link, one decision, one next action; missing ones omitted", () => {
  const n = needsYou({
    tasks: [{ id: "m", title: "Memory only", finished_at: "2026-10-27T07:00:00Z", pending: [{ evidence: [{ kind: "memory", id: "x" }] }] }, { id: "f", title: "Weekly report", finished_at: "2026-10-27T05:00:00Z", pending: file }],
    approvals: [{ id: "h1", key: "clip:j/c", title: "My clip" }],
  });
  const p = morningPicks(n);
  assert.equal(p.artifact?.ref, "task:f"); // the memory-only result has no link
  assert.equal(p.decision?.ref, "clip:j/c");
  assert.equal(p.next, undefined);
  const lead = leadItems(p);
  assert.deepEqual(lead.map((l) => l.id), ["artifact:task:f", "decision:h1"]);
  assert.deepEqual(lead[0].open, { href: "/api/workspace?ws=ws1&file=out%2Freport.md&open=1" });
});

test("the brief leads with the picks and never says the same decision twice", () => {
  const n = needsYou({ decisions: [{ id: "task:t1", title: "Ship it", what: "“Ship it”", approve: { task: "t1" } }], loops: [loop("promise:call mom", "You said you'd call mom")] });
  const x: BriefIn = { day: "2026-10-27", hour: 8, life: false, morning: {}, decisions: [{ id: "task:t1", title: "Ship it", what: "“Ship it”", approve: { task: "t1" } }], replies: [], snoozed: [], lead: leadItems(morningPicks(n)) };
  const items = briefItems(x);
  assert.deepEqual(items.slice(0, 2).map((i) => i.id), ["decision:task:t1", "next:promise:call mom"]);
  assert.equal(items.filter((i) => i.kind === "decision").length, 1);
});

test("Estonian labels for ORBIT's own lines", () => {
  const [t] = needsYou({ trust: [{ kind: "save_memory", area: "memory", from: "ask", to: "do", approved: 9, total: 10, streak: 9 }] }, "et");
  assert.match(t.title, /ORBIT võib memory/);
  assert.equal(t.detail, "Kinnitasid sel kuul 9/10");
});

test("Decide items never carry a one-tap approve, also in the brief lead", () => {
  const n = needsYou({ decisions: [{ id: "task:t1", title: "Send it", what: "", open: { task: "t1" }, approve: { task: "t1" } }, { id: "goal:g1", title: "Step OK", what: "", open: { goal: "g1" }, approve: { goal: "g1", stepId: "s1" } }] });
  assert.deepEqual(n.map((i) => i.act), [{ open: { task: "t1" } }, { open: { goal: "g1" } }]);
  const [lead] = leadItems(morningPicks(n));
  assert.equal(lead.approve, undefined);
  assert.deepEqual(lead.open, { task: "t1" });
});

test("reuse: the cached inbox serves for 60 s, then it is gathered again", () => {
  const c = { at: 1000, v: ["x"] };
  assert.deepEqual(reuse(c, 1000), ["x"]);
  assert.deepEqual(reuse(c, 60_999), ["x"]);
  assert.equal(reuse(c, 61_000), undefined);
  assert.equal(reuse(c, 999), undefined); // clock went back: refresh
  assert.equal(reuse(undefined, 1000), undefined);
});

test("a mission and its chain task are one card (task + cause), with a cause, a shared status and snooze", () => {
  const x: NeedsIn = {
    missions: [{ id: "m1", chain_id: "c1", objective: "Launch", status: "failed", blocker: "Step 2 failed", updated_at: "x" }],
    work: [{ kind: "task", id: "c1", title: "Team: Launch", status: "failed", detail: "", action: "" }, { kind: "task", id: "t2", title: "Other", status: "blocked", detail: "", action: "" }],
  };
  const all = needsYou(x);
  assert.deepEqual(all.map((n) => [n.ref, n.cause, n.status]), [["task:c1", "failed", "failed"], ["task:t2", "blocked", "blocked"]]);
  assert.deepEqual(needsYou(x, "en", ["task:c1"]).map((n) => n.ref), ["task:t2"]);
  assert.equal(needsYou({ missions: [{ id: "m", objective: "o", status: "waiting-input", updated_at: "x" }] })[0].cause, "input");
});

test("attention: overdue money > approvals > follow-ups > blockers, each with a concrete reason and one card per record", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const n = needsYou({
    now,
    approvals: [{ id: "h1", key: "approval:invoice:i1:2026-10-30", title: "Reminder to Cake", detail: "BUSINESS invoice reminder" }, { id: "h2", key: "send:p9", title: "Email to Nine" }],
    loops: [loop("prospect:p1:2026-10-28", "P1 hasn't replied"), loop("invoice:i2", "Invoice overdue")],
    work: [{ kind: "task", id: "t7", title: "Set up autopilot", status: "failed", detail: "", action: "" }],
    overdue: [{ id: "i2", number: "12", buyer: "Salon", cents: 5000, days: 2 }, { id: "i1", number: "11", buyer: "Cake", cents: 12000, days: 6 }],
    followups: [{ id: "p1", name: "Bakery", since: "2026-10-28T09:00:00Z" }, { id: "p9", name: "Nine", since: "2026-10-20T09:00:00Z" }],
    delivery: [{ ref: "task:t7", client: "Cake", clientId: "c", state: "blocked", title: "Set up autopilot", at: "2026-10-31T00:00:00Z", task: "t7" }, { ref: "project:x", client: "Salon", clientId: "s", state: "waiting", title: "Deliver: Salon", at: "2026-10-29T00:00:00Z" }],
  });
  assert.deepEqual(n.map((i) => [i.ref, i.cause]), [["invoice:i1", "overdue"], ["invoice:i2", "overdue"], ["prospect:p9", "approval"], ["prospect:p1", "followup"], ["project:x", "delivery"], ["task:t7", "delivery"]]); // the delivery card replaces the plain failed-task card, oldest first
  assert.equal(n[0].detail, "Invoice 11 is 6 days overdue");
  assert.equal(n[0].remote, "h1"); // the phone approval stays attached
  assert.equal(n[3].detail, "No reply 4 days after your message on 28 Oct");
  assert.deepEqual(n[3].act, { open: { link: "#o=business&v=client&k=client&id=p1" } });
  assert.equal(n[4].detail, "Delivery paused since 29 Oct");
  assert.deepEqual(n[5].act, { open: { task: "t7" } });
  assert.equal(needsYou({ now, followups: [{ id: "p1", name: "B", since: "2026-10-28T09:00:00Z" }] }, "et")[0].detail, "Vastust pole 4 päeva pärast sinu 28. okt sõnumit");
});

test("digest: finished by proof status, blocked, needs his decision; 24 h or since he was last here", async () => {
  const { doneDigest } = await import("../src/lib/needs-you-pure.ts");
  const now = Date.parse("2026-11-01T12:00:00Z"), h = (n: number) => new Date(now - n * 3_600_000).toISOString();
  const needs = [{ ref: "a", kind: "decide", cause: "approval", title: "Send the Bolt email", act: { open: { panel: "business" } } },
    { ref: "b", kind: "unblock", cause: "failed", title: "Mission blocked: leads", act: { open: { panel: "agents" } } }] as Parameters<typeof doneDigest>[0];
  const rs = [{ at: h(2), status: "verified" as const, title: "x" }, { at: h(5), status: "partly" as const, title: "y" }, { at: h(30), status: "failed" as const, title: "z" }];
  const d = doneDigest(needs, rs, now, null);
  assert.deepEqual(d.finished, { verified: 1, partly: 1, unverified: 0, failed: 0 });
  assert.deepEqual(d.lines, ["2 finished in the last 24 h: 1 verified, 1 partly done", "1 blocked, first: Mission blocked: leads", "1 needs your decision, first: Send the Bolt email"]);
  const away = doneDigest([], rs, now, now - 40 * 3_600_000);
  assert.equal(away.finished.failed, 1);
  assert.match(away.lines[0], /^3 finished since you were last here \(30 Oct\)/);
  assert.deepEqual(away.lines.slice(1), ["Nothing blocked", "Nothing needs your decision"]);
  assert.equal(doneDigest([], [], now, now - 60_000).lines[0], "Nothing finished in the last 24 h"); // here a minute ago: still the last 24 h
  assert.match(doneDigest([], [], now, null, "et").lines[2], /otsust/);
});
