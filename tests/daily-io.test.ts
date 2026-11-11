import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// daily.ts IO: the digest's save-before-send, backoff, quiet hours; the business-loop automation pick. Fake Supabase + fake phone.
process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-daily-"));
process.env.ORBIT_STUDIO_DIR = path.join(process.env.ORBIT_DATA_DIR, "studio");
const DATA = process.env.ORBIT_DATA_DIR;
const D = await import("../src/lib/daily.ts");
const { slotAt } = await import("../src/lib/daily-pure.ts");

function sb(rows: Record<string, unknown[]>) {
  const q = (t: string) => { const b: Record<string, unknown> = {}; for (const k of ["select", "eq", "is", "gte", "order", "limit"]) b[k] = () => b; b.then = (ok: (r: unknown) => void) => ok({ data: rows[t] ?? [], error: null }); return b; };
  return { from: q } as never;
}
const empty = sb({});
function phone(o: { result?: "sent" | "refused" | "unknown"; quiet?: boolean; after?: () => Promise<void> } = {}) {
  const sent: { message: string }[] = [];
  return { sent, load: async () => ({ ready: () => ({ open: "" }), allowed: () => !o.quiet, send: async (m: { message: string }) => { sent.push(m); await o.after?.(); return o.result ?? "sent"; } }) as never };
}
const T = (hhmm: string) => slotAt(new Date(2026, 10, 5, 12).getTime(), hhmm);
const state = async () => JSON.parse(await readFile(path.join(DATA, "daily.json"), "utf8").catch(() => "{}"));
const reset = () => rm(path.join(DATA, "daily.json"), { force: true });

test("digest: sent once a day; a definite refusal retries after 30 min; quiet hours hold it before anything is read or sent", async () => {
  await reset();
  const no = phone({ result: "refused" });
  assert.equal(await D.maybeDailyDigest(empty, "u1", T("10:31"), no.load), false);
  assert.equal(no.sent.length, 1);
  assert.equal((await state()).failed, true);
  assert.equal(await D.maybeDailyDigest(empty, "u1", T("10:40"), no.load), false);
  assert.equal(no.sent.length, 1, "no retry every tick");
  const up = phone();
  assert.equal(await D.maybeDailyDigest(empty, "u1", T("11:02"), up.load), true);
  assert.match(up.sent[0].message, /^Brief: \w/);
  assert.equal((await state()).sent, "2026-11-05");
  assert.equal(await D.maybeDailyDigest(empty, "u1", T("12:00"), up.load), false);
  assert.equal(up.sent.length, 1, "once a day");
  await reset();
  const quiet = phone({ quiet: true });
  assert.equal(await D.maybeDailyDigest(empty, "u1", T("10:31"), quiet.load), false);
  assert.equal(quiet.sent.length, 0);
  assert.deepEqual(await state(), {}, "nothing recorded, so it goes out when quiet hours end (within 4 h)");
});

test("digest: at most one a day even when the send may have landed: no answer from ntfy, or the 'sent' mark failing to save, then a restart", async () => {
  await reset();
  const timeout = phone({ result: "unknown" }); // ntfy may have accepted it before the 10 s timeout
  await D.maybeDailyDigest(empty, "u1", T("10:31"), timeout.load);
  for (const t of ["11:05", "12:00", "14:00"]) await D.maybeDailyDigest(empty, "u1", T(t), timeout.load);
  assert.equal(timeout.sent.length, 1, "counted as sent: not repeated");
  await reset();
  // sent fine, then the "sent" write fails (rename target becomes a directory): the saved try stays on disk
  const lockAfter = phone({ after: () => mkdir(path.join(DATA, "daily.json.tmp"), { recursive: true }).then(() => {}) });
  await D.maybeDailyDigest(empty, "u1", T("10:31"), lockAfter.load);
  await rm(path.join(DATA, "daily.json.tmp"), { recursive: true });
  assert.ok((await state()).tried && !(await state()).sent, "only the try was saved");
  // a restart reads the same file (nothing is kept in memory): every later tick today sends nothing
  const again = phone();
  for (const t of ["11:02", "11:40", "13:00", "14:20"]) assert.equal(await D.maybeDailyDigest(empty, "u1", T(t), again.load), false);
  assert.equal(lockAfter.sent.length + again.sent.length, 1, "exactly one digest that day");
});

test("digest: if the try can't be saved, nothing is sent (no resend loop from a broken disk)", async () => {
  await reset();
  await mkdir(path.join(DATA, "daily.json.tmp"), { recursive: true }); // writeFile(tmp) fails with EISDIR
  const p = phone();
  assert.equal(await D.maybeDailyDigest(empty, "u1", T("10:31"), p.load), false);
  assert.equal(p.sent.length, 0);
  await rm(path.join(DATA, "daily.json.tmp"), { recursive: true });
});

test("leads: an enabled scheduled copy wins over a paused one; a weekly loop follows its own schedule", async () => {
  const weekday = new Date(T("12:00")).getDay();
  const autos = [
    { id: "old", name: "Daily business loop", enabled: false, trigger: "schedule", schedule: { every: "day", hour: 9, minute: 15 }, prompt: "Daily business loop..." },
    { id: "wk", name: "Daily business loop", enabled: true, trigger: "schedule", schedule: { every: "week", weekday: (weekday + 4) % 7, hour: 9, minute: 15 }, prompt: "Daily business loop..." },
  ];
  const doneLastRun = [{ title: "x", request: "x", status: "done", error: null, pending: null, trace: [], created_at: new Date(T("09:15") - 3 * 86_400_000).toISOString() }];
  const v = await D.dailyRuns(sb({ automations: autos, tasks: doneLastRun }), "u1", T("12:00"));
  const leads = v.items.find((i) => i.wf === "leads")!;
  assert.equal(leads.state, "completed", "the enabled weekly copy, showing its last run, not MISSED and not the paused copy's 'off'");
  const none = (await D.dailyRuns(sb({ automations: autos, tasks: [] }), "u1", T("12:00"))).items.find((i) => i.wf === "leads")!;
  assert.equal(none.state, "missed");
  assert.match(none.evidence, /Every \w+ at 09:15/);
});

test("status event: one per day across ticks and restarts (state on disk), emitted after the brief catches up", async () => {
  await rm(path.join(DATA, "daily-status.json"), { force: true });
  const got: Record<string, unknown>[] = [];
  const emit = async (d: Record<string, unknown>) => { got.push(d); };
  assert.equal(await D.maybeDailyStatus(empty, "u1", T("10:00"), emit), false, "before 10:30");
  const brief = sb({ briefings: [{ kind: "morning", created_at: new Date(T("13:01")).toISOString(), article_count: 7 }] });
  assert.equal(await D.maybeDailyStatus(brief, "u1", T("13:02"), emit), true, "PC woke at 13:00: the caught-up brief is in it");
  for (const t of ["13:03", "18:00", "23:00"]) await D.maybeDailyStatus(brief, "u1", T(t), emit);
  assert.equal(got.length, 1, "never twice a day");
  assert.equal(got[0].brief, "done");
  assert.ok(["done", "needs-you", "running"].includes(String(got[0].clips)) && ["done", "needs-you", "running"].includes(String(got[0].leads)));
  assert.equal(got[0].day, "2026-11-05");
});
