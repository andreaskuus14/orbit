// B03/B06: durable-state writes that fail (disk full, EACCES) never pass as saved; restart after each failure point; dead letters.
// Failure injection on the real fs, root-proof: a directory sitting where "<file>.tmp" goes makes the atomic write fail (EISDIR).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !/\\.[a-z]+$/.test(s)) return next(s + ".ts", c); throw e; } }`));

const DIR = (process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-durfail-")));
const { claimEvents, ackEvent, getCursor, writeFailures, deadEvents, retryEvent } = await import("../src/lib/durable.ts");
const { handleEvents } = await import("../src/lib/automations.ts");
const { updateCheckpoint } = await import("../src/lib/checkpoint.ts");
const { durableCheck } = await import("../src/lib/durable-pure.ts");
const { needsYou } = await import("../src/lib/needs-you-pure.ts");
const G = globalThis as unknown as { __orbitDurable: { cursors?: unknown; tracks?: unknown; chain: Promise<unknown> } };
const restart = async () => { await G.__orbitDurable.chain.catch(() => {}); G.__orbitDurable.cursors = undefined; G.__orbitDurable.tracks = undefined; };
const breakFile = (name: string) => mkdir(path.join(DIR, name + ".tmp"), { recursive: true });
const fixFile = (name: string) => rm(path.join(DIR, name + ".tmp"), { recursive: true, force: true });

type Row = Record<string, unknown> & { id: number | string };
function fakeSb(tables: Record<string, Row[]>) {
  return { from: (t: string) => {
    let out = [...(tables[t] ??= [])]; let n = Infinity; let ins: Row | null = null;
    const b: Record<string, unknown> = {
      select: () => b, single: () => b, update: () => b, is: () => b, maybeSingle: () => b, neq: () => b, gte: () => b, lte: () => b,
      eq: (c: string, v: unknown) => { out = out.filter((r) => r[c] === v); return b; },
      gt: (c: string, v: number) => { out = out.filter((r) => (r[c] as number) > v); return b; },
      in: (c: string, v: unknown[]) => { out = out.filter((r) => v.includes(r[c])); return b; },
      like: (c: string, p: string) => { out = out.filter((r) => String(r[c]).endsWith(p.slice(1))); return b; },
      order: (_c: string, o?: { ascending: boolean }) => { out.sort((a, z) => (o?.ascending === false ? -1 : 1) * ((a.id as number) - (z.id as number))); return b; },
      limit: (k: number) => { n = k; return b; },
      insert: (r: Row) => { ins = { ...r, id: `task-${tables[t].length + 1}` }; return b; },
      then: (ok: (v: unknown) => unknown) => {
        if (ins) { tables[t].push(ins); return Promise.resolve({ data: ins, error: null }).then(ok); }
        return Promise.resolve({ data: out.slice(0, n), error: null }).then(ok);
      },
    };
    return b;
  } } as never;
}
const ev = (id: number, title = "note") => ({ id, user_id: "u", type: "memory.created", payload: { source: "capture", kind: "note", title }, created_at: new Date().toISOString() });
const auto = { id: "a1", user_id: "u", name: "On save", trigger: "event", schedule: null, event: "memory.created", kind_filter: null, agent: "nova",
  prompt: "Summarise it", last_run_at: null, run_count: 0, created_at: new Date().toISOString(), enabled: true };
const keyed = (tasks: Row[], id: number) => tasks.filter((x) => String(x.request).includes(`[event:automations:${id}:a1]`)).length;

test("event-track.json write fails at claim: nothing is acted on or acked, the failure is named; after the fix + restart it runs once", async () => {
  const tables: Record<string, Row[]> = { events: [ev(1)], tasks: [], automations: [auto] }, sb = fakeSb(tables);
  await handleEvents(sb); // first run: cursor starts at the newest
  tables.events.push(ev(2));
  await breakFile("event-track.json");
  await assert.rejects(handleEvents(sb)); // the "processing" mark couldn't be saved → the event is not handed out
  assert.equal(tables.tasks.length, 0);
  assert.equal(getCursor("automations"), 1);
  const f = writeFailures().find((x) => x.what === "event-track.json");
  assert.ok(f && /EISDIR|directory/i.test(f.error), "precise exception: which file, which error");
  await restart(); await fixFile("event-track.json");
  await handleEvents(sb);
  assert.equal(keyed(tables.tasks, 2), 1);
  assert.equal(getCursor("automations"), 2);
  assert.equal(writeFailures().find((x) => x.what === "event-track.json"), undefined, "a later good write clears it");
  await restart(); await handleEvents(sb);
  assert.equal(tables.tasks.length, 1);
});

test("ack write fails after the effect: not acknowledged; the replay after restart finds the task by key (no duplicate)", async () => {
  const tables: Record<string, Row[]> = { events: [ev(10)], tasks: [], automations: [{ ...auto }] }, sb = fakeSb(tables);
  await restart();
  await claimEvents(sb, "c-ack", ["memory.created"]); // init
  tables.events.push(ev(11));
  const got = await claimEvents(sb, "c-ack", ["memory.created"]);
  assert.deepEqual(got.map((e) => e.id), [11]);
  await breakFile("event-track.json");
  await assert.rejects(ackEvent("c-ack", 11));
  assert.equal(getCursor("c-ack"), 10, "cursor never moves past an event whose ack wasn't saved");
  await restart(); await fixFile("event-track.json");
  assert.deepEqual((await claimEvents(sb, "c-ack", ["memory.created"])).map((e) => e.id), [11], "replayed, not lost");
  await ackEvent("c-ack", 11);
  assert.equal(getCursor("c-ack"), 11);
  // the same failure point through the real consumer: effect made, ack fails, restart → one task
  await handleEvents(sb); // automations cursor exists from test 1 (at 2): 10, 11 are new for it
  tables.events.push(ev(12));
  await breakFile("event-track.json");
  const before = tables.tasks.length;
  await assert.rejects(handleEvents(sb));
  await restart(); await fixFile("event-track.json");
  await handleEvents(sb); await handleEvents(sb);
  assert.ok(tables.tasks.length >= before);
  for (const id of [10, 11, 12]) assert.ok(keyed(tables.tasks, id) <= 1, `event ${id} created at most one task`);
});

test("cursor write fails after the track was saved: restart neither repeats nor loses the event, the cursor catches up", async () => {
  const tables = { events: [ev(20)] }, sb2 = fakeSb(tables);
  await restart();
  await claimEvents(sb2, "c-cur", ["memory.created"]);
  tables.events.push(ev(21), ev(22));
  const got = await claimEvents(sb2, "c-cur", ["memory.created"]);
  assert.deepEqual(got.map((e) => e.id), [21, 22]);
  await ackEvent("c-cur", 21);
  await breakFile("event-cursors.json");
  await assert.rejects(ackEvent("c-cur", 22));
  assert.ok(writeFailures().some((x) => x.what === "event-cursors.json"));
  await restart(); await fixFile("event-cursors.json");
  assert.deepEqual(await claimEvents(sb2, "c-cur", ["memory.created"]), [], "22's ack is in the saved track: not repeated");
  tables.events.push(ev(23));
  assert.deepEqual((await claimEvents(sb2, "c-cur", ["memory.created"])).map((e) => e.id), [23]);
  await ackEvent("c-cur", 23);
  assert.equal(getCursor("c-cur"), 23);
});

test("dead letter: an event given up after two crashes is a visible item with its summary, and Retry hands it out once more", async () => {
  const tables = { events: [ev(30)] }, sb = fakeSb(tables);
  await restart();
  await claimEvents(sb, "c-dead", ["memory.created"]);
  tables.events.push(ev(31, "Trip plan"), ev(32));
  await claimEvents(sb, "c-dead", ["memory.created"]); await restart(); // crash 1 (no ack)
  await claimEvents(sb, "c-dead", ["memory.created"]); await restart(); // crash 2
  const third = await claimEvents(sb, "c-dead", ["memory.created"]);
  assert.deepEqual(third, [], "both given up");
  const dead = deadEvents().filter((d) => d.consumer === "c-dead");
  assert.deepEqual(dead.map((d) => d.id), [31, 32]);
  assert.match(dead[0].summary, /memory\.created.*Trip plan/);
  const c = durableCheck([], deadEvents());
  assert.equal(c.status, "warn");
  assert.ok(c.retry?.some((r) => r.key === "c-dead:31" && /Trip plan/.test(r.label)), "Doctor offers Retry with the summary");
  const needs = needsYou({ durable: { id: "durable", title: c.detail } });
  assert.equal(needs[0]?.kind, "unblock");
  assert.deepEqual(needs[0]?.act, { open: { doctor: true } });

  assert.equal(await retryEvent("c-dead", 31), true);
  assert.equal(await retryEvent("c-dead", 999), false, "only a dead event can be retried");
  await restart(); // the retry request itself is durable
  assert.deepEqual((await claimEvents(sb, "c-dead", ["memory.created"])).map((e) => e.id), [31]);
  await ackEvent("c-dead", 31);
  assert.deepEqual(deadEvents().filter((d) => d.consumer === "c-dead").map((d) => d.id), [32]);
  assert.deepEqual(await claimEvents(sb, "c-dead", ["memory.created"]), [], "handed out once");
});

test("a retried event that crashes again stays a dead letter (never silently gone)", async () => {
  await restart();
  const sb = fakeSb({ events: [ev(30), ev(31), ev(32)] });
  assert.equal(await retryEvent("c-dead", 32), true);
  assert.deepEqual((await claimEvents(sb, "c-dead", ["memory.created"])).map((e) => e.id), [32]);
  await restart(); // crash before the ack
  assert.deepEqual(deadEvents().filter((d) => d.consumer === "c-dead").map((d) => d.id), [32]);
});

test("checkpoints.json write fails: the update rejects (nothing claims it was saved) and the failure is named until a good write", async () => {
  await breakFile("checkpoints.json");
  await assert.rejects(updateCheckpoint("u", "chat", (cp) => { cp.lines.push({ id: "l1", kind: "decision", text: "x", by: "owner", at: new Date().toISOString() } as never); }));
  assert.ok(writeFailures().some((x) => x.what === "checkpoints.json"));
  assert.equal(durableCheck(writeFailures(), []).status, "fail");
  await fixFile("checkpoints.json");
  await updateCheckpoint("u", "chat", () => {});
  assert.ok(!writeFailures().some((x) => x.what === "checkpoints.json"));
});

test("durableCheck: all good is ok", () => {
  assert.equal(durableCheck([], []).status, "ok");
});
