import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { mock } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-bgresume-"));
const { resumeRows, resumeBackgroundTurns, SAVE_FAILED } = await import("../src/lib/bg-resume.ts");
const { newBgTurn } = await import("../src/lib/bg-resume-pure.ts");
const DATA = process.env.ORBIT_DATA_DIR!;

// A fake Supabase that honours order + limit the way Postgres does, over a 300-message chat.
function chat(n: number) { return chatOf(n, true); }
const updates: unknown[] = [];
function chatOf(n: number, marks = false) {
  const rows = Array.from({ length: n }, (_, i) => ({ i, role: i % 2 ? "assistant" : "user", content: `message ${i}`, created_at: new Date(Date.UTC(2026, 10, 5, 8, 0, i)).toISOString() }));
  if (marks) rows[10] = { ...rows[10], content: "An old request." };
  if (marks) rows[296] = { ...rows[296], content: "Decision: the site is blue, not green." }; // a late correction
  if (marks) rows[298] = { ...rows[298], content: "Build the golf site now." }; // the request the background turn was running
  const q = { asc: true, lim: Infinity };
  const b = {
    select: () => b, eq: () => b, update: (v: unknown) => ((updates.push(v)), b),
    order: (_c: string, o: { ascending: boolean }) => ((q.asc = o.ascending), b),
    limit: (n2: number) => ((q.lim = n2), b),
    then: (ok: (r: unknown) => void) => ok({ data: [...rows].sort((x, y) => (q.asc ? 1 : -1) * x.created_at.localeCompare(y.created_at)).slice(0, q.lim).map(({ role, content }) => ({ role, content })), error: null }),
  };
  return { from: () => b } as never;
}

test("a restart in a 300-message chat resumes with the newest messages, in order, ending at the request", async () => {
  const h = await resumeRows(chat(300), "c1", "Build the golf site now.");
  assert.equal(h.length, 60);
  assert.equal(h.at(-1)!.content, "Build the golf site now.");
  assert.ok(h.some((m) => m.content.startsWith("Decision: the site is blue")), "the late correction survives");
  assert.deepEqual(h.slice(0, 2).map((m) => m.content), ["message 239", "message 240"]); // time order, oldest of the window first
});

test("a short chat resumes whole, in order, up to the request", async () => {
  const h = await resumeRows(chat(300), "c1", "An old request."); // the window is the newest 200: message 10 is outside it
  assert.deepEqual(h, []); // bg-resume then reports "the request is no longer in the chat" rather than resuming the wrong turn
  const short = await resumeRows(chatOf(12), "c1", "message 10");
  assert.deepEqual(short.map((m) => m.content), Array.from({ length: 11 }, (_, i) => `message ${i}`));
});

// ── A real restart: the record and lease a crashed ORBIT left on disk, picked up by the real sweep (lease, attempt checkpoint,
// history window, record cleanup). Only core.ts / core-turn.ts are faked: finishBackground below follows its contract.
type Fin = { result?: unknown; error?: { orbitReason?: string }; dropped?: boolean };
function harness(onRun: (history: { content: string }[], signal: AbortSignal) => Promise<void> | void = () => {}) {
  const calls: { history: { content: string }[]; attemptsOnDisk: number }[] = [];
  let done!: (f: Fin) => void;
  const finished = new Promise<Fin>((r) => (done = r));
  const load = async () => ({
    BACKGROUND_TURN_MS: 60_000, parseLang: () => "en", coreSessionStore: { get: () => undefined, set: () => {} },
    chatProjectContext: async () => ({ text: "", tainted: false }),
    runCoreFor: async (_ms: number, _bg: boolean, _sb: unknown, _u: string, history: { content: string }[], _a: unknown, signal: AbortSignal) => {
      calls.push({ history, attemptsOnDisk: JSON.parse(await readFile(path.join(DATA, "bg-turns", "t1.json"), "utf8")).attempts });
      await onRun(history, signal);
      return { text: "Built it.", citations: [], trace: [] };
    },
    // follows core-turn.ts finishBackground's ownership checks: before the answer write and before the failure write
    finishBackground: (_sb: unknown, _u: string, _c: string, _t: string, _title: string, run: (s: AbortSignal) => Promise<unknown>, stop?: (() => Promise<void>) & { lost?: AbortSignal; confirm?: () => Promise<boolean> }) => (async () => {
      const lost = stop?.lost ?? new AbortController().signal;
      try { const result = await run(lost); if (lost.aborted || (stop?.confirm && !(await stop.confirm()))) throw lost.reason; await stop?.(); done({ result }); }
      catch (e) { const gone = lost.aborted || (stop?.confirm && !(await stop.confirm())); await stop?.(); done(gone ? { dropped: true } : { error: e as { orbitReason?: string } }); }
      return null;
    })(),
  });
  return { calls, finished, load: load as never };
}
async function leftBehind() {
  await rm(DATA, { recursive: true, force: true });
  await mkdir(path.join(DATA, "bg-turns"), { recursive: true });
  await writeFile(path.join(DATA, "bg-turns", "t1.json"), JSON.stringify(newBgTurn({ taskId: "t1", userId: "u1", chatId: "c1", request: "Build the golf site now.", title: "Golf site" }, Date.now() - 600_000)));
  await mkdir(path.join(DATA, "jobs"), { recursive: true });
}
const leaseFiles = async () => (await readdir(path.join(DATA, "jobs")).catch(() => [] as string[])).filter((f) => f.startsWith("bgturn_t1") && f.endsWith(".lease"));

test("restart: the sweep takes the turn, records the attempt before running, resumes with the newest messages, then cleans up", async () => {
  await leftBehind();
  const h = harness();
  updates.length = 0;
  await resumeBackgroundTurns(chat(300), "u1", h.load);
  const f = await h.finished;
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].attemptsOnDisk, 1, "the attempt was on disk before the run");
  assert.equal(h.calls[0].history.at(-1)!.content, "Build the golf site now.");
  assert.ok(h.calls[0].history.some((m) => m.content.startsWith("Decision: the site is blue")), "the latest correction survives the restart");
  assert.deepEqual((f.result as { text: string }).text, "Built it.");
  assert.ok("started_at" in (updates[0] as object) && !("status" in (updates[0] as object)), "resumes only a row still running; never flips one back");
  assert.deepEqual(await readdir(path.join(DATA, "bg-turns")), [], "record gone once it finished");
  assert.deepEqual(await leaseFiles(), [], "lease released");
});

test("restart: if the attempt can't be saved, the turn does not run and says why", async () => {
  await leftBehind();
  await mkdir(path.join(DATA, "bg-turns", "t1.json.tmp")); // writeFile(tmp) now fails (EISDIR), as a full or broken disk would
  const h = harness();
  await resumeBackgroundTurns(chat(300), "u1", h.load);
  const f = await h.finished;
  assert.equal(h.calls.length, 0, "nothing ran without its checkpoint");
  assert.equal(f.error?.orbitReason, SAVE_FAILED);
});

test("restart: when another ORBIT takes the lease mid-run, this one stops, writes nothing and leaves the record for the new owner", async () => {
  await leftBehind();
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const h = harness(async (_h, signal) => {
      const [lf] = await leaseFiles();
      await writeFile(path.join(DATA, "jobs", lf), JSON.stringify({ owner: "other-pc:42:abcd", until: Date.now() + 600_000 }));
      mock.timers.tick(60_000); // the renewal tick
      for (let i = 0; i < 50 && !signal.aborted; i++) await new Promise((r) => setTimeout(r, 10));
      assert.ok(signal.aborted, "the run was told to stop");
    });
    await resumeBackgroundTurns(chat(300), "u1", h.load);
    const f = await h.finished;
    assert.equal(f.dropped, true, "no answer or failure written from here");
    assert.deepEqual(await readdir(path.join(DATA, "bg-turns")), ["t1.json"], "record kept for the new owner");
    const [lf] = await leaseFiles();
    assert.equal(JSON.parse(await readFile(path.join(DATA, "jobs", lf), "utf8")).owner, "other-pc:42:abcd", "their lease untouched");
  } finally { mock.timers.reset(); }
});

test("a lease that can never be written doesn't kill the turn: no one else can own it, so it finishes and answers", async () => {
  await leftBehind();
  await rm(path.join(DATA, "jobs"), { recursive: true, force: true });
  await writeFile(path.join(DATA, "jobs"), "not a folder"); // every takeLease now throws (ENOTDIR/EEXIST)
  // the sweep needs the lease to start a resume, so drive trackTurn directly, as a fresh turn does
  const { trackTurn } = await import("../src/lib/bg-resume.ts");
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const stop = await trackTurn(newBgTurn({ taskId: "t9", userId: "u1", chatId: "c1", request: "x", title: "x" }, Date.now()));
    for (let i = 0; i < 5; i++) { mock.timers.tick(60_000); await new Promise((r) => setTimeout(r, 20)); } // 5 failed renewals
    assert.equal(stop.lost.aborted, false, "not aborted: the lease was never ours, so nobody can have taken it");
    assert.equal(await stop.confirm(), true);
    await stop();
  } finally { mock.timers.reset(); await rm(path.join(DATA, "jobs"), { force: true }); }
});

test("a process that stalled past its lease can't write a stale answer: the check right before writing catches it", async () => {
  await leftBehind();
  const h = harness(async () => {
    const [lf] = await leaseFiles(); // the new owner took the lease while this run was busy; no renewal tick happened
    await writeFile(path.join(DATA, "jobs", lf), JSON.stringify({ owner: "other-pc:42:abcd", until: Date.now() + 600_000 }));
  });
  await resumeBackgroundTurns(chat(300), "u1", h.load);
  const f = await h.finished;
  assert.equal(f.dropped, true, "the answer isn't written");
  assert.deepEqual(await readdir(path.join(DATA, "bg-turns")), ["t1.json"], "record kept for the new owner");
});

test("restart: a turn whose task was cancelled or retried meanwhile is not resumed (no second copy), and its record goes", async () => {
  await leftBehind();
  const h = harness();
  const real = chat(300) as unknown as { from: (t: string) => Record<string, unknown> };
  const sb = { from: (t: string) => { const b = real.from(t); return t === "tasks" ? { ...b, update: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }) }) } : b; } } as never;
  await resumeBackgroundTurns(sb, "u1", h.load);
  // The sweep starts the cleanup asynchronously. Wait for both filesystem effects before checking them.
  for (let i = 0; i < 100; i++) {
    if (!(await readdir(path.join(DATA, "bg-turns"))).length && !(await leaseFiles()).length) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(h.calls.length, 0, "nothing ran");
  assert.deepEqual(await readdir(path.join(DATA, "bg-turns")), [], "record removed");
  assert.deepEqual(await leaseFiles(), [], "lease released");
});
