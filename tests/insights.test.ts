import { test } from "node:test";
import assert from "node:assert/strict";
import { act, asksWhatToDo, detect, emptyInsights, insightsProblem, merge, visible, type InsightInput } from "../src/lib/insights-pure.ts";

const NOW = Date.parse("2026-10-16T10:00:00Z"), H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const base = (o: Partial<InsightInput> = {}): InsightInput => ({ now: NOW, tz: "Europe/Tallinn", jobs: [], downloads: [], ytPausedUntil: 0, learn: [], picks: [], ...o });
const rec = (id: string, views: number, extra: Partial<InsightInput["learn"][0]> = {}) =>
  ({ videoId: id.padEnd(11, "x"), jobId: "abc123-aaaaaa", clipId: "clip-1", title: `T ${id}`, sourceChannel: "Kai Cenat", publishedAt: iso(NOW - 80 * H), snaps: { "72h": { views } }, ...extra });
const job = (clips: InsightInput["jobs"][0]["clips"], o: Partial<InsightInput["jobs"][0]> = {}) =>
  ({ id: "abc123-aaaaaa", source: "Kai_Cenat_-_stream.mp4", status: "done", createdAt: iso(NOW - 2 * H), updatedAt: iso(NOW - 2 * H), clips, ...o });

test("hot: ≥2× median at 72h gets versions + creator actions", () => {
  const s = detect(base({ learn: [rec("a", 100), rec("b", 120), rec("c", 90), rec("d", 400)], jobs: [job([{ id: "clip-1", title: "x", status: "approved" }])] }));
  const hot = s.filter((x) => x.kind === "hot");
  assert.equal(hot.length, 1);
  assert.equal(hot[0].key, "hot:dxxxxxxxxxx");
  assert.equal(hot[0].priority, "high");
  assert.deepEqual(hot[0].actions.map((a) => a.label), ["Make 2 more versions of this moment", "Find more clips from this creator"]);
  assert.equal(hot[0].actions[0].post!.length, 2);
  assert.equal(hot[0].actions[1].post![0].body!.input, "Kai Cenat");
});

test("hot: needs 3 samples and a recent video", () => {
  assert.equal(detect(base({ learn: [rec("a", 100), rec("d", 400)] })).length, 0);
  assert.equal(detect(base({ learn: [rec("a", 100), rec("b", 100), rec("c", 100), rec("d", 900, { publishedAt: iso(NOW - 30 * 24 * H) })] })).length, 0);
});

test("new watchlist upload → Clip it now", () => {
  const s = detect(base({ picks: [{ videoId: "AAAAAAAAAAA", title: "Big stream", channel: "Kai", source: "watchlist", status: "new" },
    { videoId: "BBBBBBBBBBB", title: "kw", channel: "x", source: "keyword", status: "new" }, { videoId: "CCCCCCCCCCC", title: "q", channel: "x", source: "watchlist", status: "queued" }] }));
  assert.deepEqual(s.map((x) => x.key), ["upload:AAAAAAAAAAA"]);
  assert.deepEqual(s[0].actions[0].post![0].body, { videoId: "AAAAAAAAAAA", action: "clip" });
});

test("ready > 12 h, approved unscheduled, tomorrow empty", () => {
  const old = job([{ id: "clip-1", title: "a", status: "ready" }, { id: "clip-2", title: "b", status: "approved" }], { createdAt: iso(NOW - 13 * H) });
  const s = detect(base({ jobs: [old] }));
  assert.deepEqual(s.map((x) => x.kind).sort(), ["approved", "ready"]);
  assert.equal(s.find((x) => x.kind === "approved")!.actions[0].post![0].url, "/api/studio/clips/schedule");
  // fresh ready clips don't nag
  assert.equal(detect(base({ jobs: [job([{ id: "clip-1", title: "a", status: "ready" }])] })).length, 0);
  // channel that has published, nothing for tomorrow, nothing approved → fill tomorrow (review first if clips are ready)
  const pub = job([{ id: "clip-1", title: "a", status: "approved", publish: { status: "done" } }, { id: "clip-2", title: "b", status: "ready" }]);
  const t = detect(base({ jobs: [pub] }));
  assert.equal(t.length, 1);
  assert.equal(t[0].key, "tomorrow:2026-10-17");
  assert.equal(t[0].actions[0].label, "Fill tomorrow's slots");
  assert.deepEqual(t[0].actions[0].nav, { panel: "studio", view: "review" });
  // a Short scheduled for tomorrow (Tallinn) → no suggestion
  const sched = job([{ id: "clip-1", title: "a", status: "approved", publish: { status: "scheduled", scheduledFor: "2026-10-17T09:00:00Z" } }]);
  assert.equal(detect(base({ jobs: [sched] })).length, 0);
});

test("doctor: YouTube pause and repeated failures", () => {
  const s = detect(base({ ytPausedUntil: NOW + H, jobs: [job([], { status: "failed", updatedAt: iso(NOW - H) })],
    downloads: [{ status: "failed", error: "boom", createdAt: iso(NOW - H) }, { status: "failed", error: "Sign in to confirm you're not a bot", createdAt: iso(NOW - H) }] }));
  assert.deepEqual(s.map((x) => x.kind), ["doctor", "doctor"]);
  assert.match(s[1].title, /^2 jobs failed/); // the bot-wall one counts as the pause, not a failure
  assert.deepEqual(s[0].actions[0].nav, { panel: null, doctor: true });
});

test("merge: dedup by key, dismiss sticks, resolved drops, expired drops", () => {
  const d = (key: string, exp = NOW + H) => ({ key, kind: "ready" as const, priority: "normal" as const, title: key, detail: "", actions: [], expiresAt: exp });
  let s = merge(emptyInsights(), [d("a"), d("b")], NOW);
  assert.equal(s.items.length, 2);
  assert.ok(act(s, "a", "dismiss", NOW));
  assert.ok(!act(s, "zzz", "dismiss", NOW));
  s = merge(s, [d("a"), d("b"), d("b")].slice(0, 2), NOW + 1000);
  assert.equal(s.items.find((i) => i.key === "a")!.dismissed, true);
  assert.equal(s.items.find((i) => i.key === "b")!.createdAt, NOW); // kept from the first sighting
  assert.deepEqual(visible(s, NOW).map((i) => i.key), ["b"]);
  s = merge(s, [], NOW + 2000); // both resolved: b goes, dismissed a stays until it expires
  assert.deepEqual(s.items.map((i) => i.key), ["a"]);
  s = merge(s, [], NOW + 2 * H);
  assert.equal(s.items.length, 0);
});

test("snooze hides for hours; high priority first", () => {
  const s = merge(emptyInsights(), [
    { key: "n", kind: "ready", priority: "normal", title: "n", detail: "", actions: [], expiresAt: NOW + 99 * H },
    { key: "h", kind: "doctor", priority: "high", title: "h", detail: "", actions: [], expiresAt: NOW + 99 * H }], NOW);
  assert.deepEqual(visible(s, NOW).map((i) => i.key), ["h", "n"]);
  act(s, "h", "snooze", NOW, 2);
  assert.deepEqual(visible(s, NOW + H).map((i) => i.key), ["n"]);
  assert.deepEqual(visible(s, NOW + 3 * H).map((i) => i.key), ["h", "n"]);
  const gone = merge(s, [], NOW + H); // snoozed h survives a temporary disappearance, n (resolved) goes
  assert.deepEqual(gone.items.map((i) => i.key), ["h"]);
  assert.ok(gone.items[0].snoozeUntil! > NOW + H);
});

test("state check and 'anything I should do?'", () => {
  assert.equal(insightsProblem(emptyInsights()), "");
  assert.notEqual(insightsProblem({ v: 1, at: 0, items: [{}] }), "");
  for (const q of ["Anything I should do?", "what should I do today", "what's next?", "any suggestions?", "Is there anything I need to do"]) assert.ok(asksWhatToDo(q), q);
  for (const q of ["what is the weather", "do you know Kai Cenat?"]) assert.ok(!asksWhatToDo(q), q);
});

// LIFE rules. NOW is Fri 13:00 in Tallinn (UTC+3); 16:00Z = 19:00, 18:00Z = 21:00 local.
const hv = (name: string, streak: number, o: Record<string, unknown> = {}) =>
  ({ id: name, name, emoji: "💧", days: [0, 1, 2, 3, 4, 5, 6], created: "2026-01-01", done: [], week: [], streak, scheduledToday: true, doneToday: false, ...o });
const life = (habits: ReturnType<typeof hv>[], focus = { today: 0, week: 0 }) => ({ habits, focus });
const lifeAt = (iso: string, l: ReturnType<typeof life>) => detect(base({ now: Date.parse(iso), life: l })).filter((x) => x.kind === "life");

test("life: evening streak guard picks the longest streak, normal priority, opens LIFE today", () => {
  const habits = [hv("Water", 4), hv("Read", 9), hv("Run", 2), hv("Walk", 20, { doneToday: true }), hv("Gym", 30, { scheduledToday: false })];
  const s = lifeAt("2026-10-16T16:00:00Z", life(habits));
  assert.deepEqual(s.map((x) => x.key), ["streak:2026-10-16"]);
  assert.equal(s[0].title, "Keep your 🔥9 streak: 💧 Read isn't done yet");
  assert.equal(s[0].priority, "normal");
  assert.deepEqual(s[0].actions[0].nav, { panel: "life", life: "today" });
  assert.equal(lifeAt("2026-10-16T14:59:00Z", life(habits)).length, 0); // 17:59 local
  assert.equal(lifeAt("2026-10-16T16:00:00Z", life([hv("Run", 2)])).length, 0);
});

test("life: after 20:00 also a low 'N habits left'", () => {
  const s = lifeAt("2026-10-16T18:00:00Z", life([hv("Water", 4), hv("Run", 0)]));
  assert.deepEqual(s.map((x) => [x.key, x.priority]), [["streak:2026-10-16", "normal"], ["habitsleft:2026-10-16", "low"]]);
  assert.equal(s[1].title, "2 habits left today");
  assert.equal(lifeAt("2026-10-16T18:00:00Z", life([hv("Run", 0, { doneToday: true })])).length, 0);
});

test("life: no focus yet on a weekday 10–17 when focus is used", () => {
  const s = lifeAt("2026-10-16T10:00:00Z", life([], { today: 0, week: 50 }));
  assert.deepEqual(s.map((x) => [x.key, x.priority]), [["focus:2026-10-16", "low"]]);
  assert.deepEqual(s[0].actions[0].nav, { panel: "life", life: "focus" });
  assert.equal(lifeAt("2026-10-16T10:00:00Z", life([], { today: 25, week: 50 })).length, 0);
  assert.equal(lifeAt("2026-10-16T10:00:00Z", life([], { today: 0, week: 0 })).length, 0); // never uses focus
  assert.equal(lifeAt("2026-10-17T10:00:00Z", life([], { today: 0, week: 50 })).length, 0); // Saturday
  assert.equal(lifeAt("2026-10-16T14:00:00Z", life([], { today: 0, week: 50 })).length, 0); // 17:00 local
  assert.equal(detect(base({ life: null })).length, 0);
});

test("visible: high, then normal, then low", () => {
  const mk = (key: string, priority: "high" | "normal" | "low", createdAt: number) =>
    ({ key, kind: "life" as const, priority, title: key, detail: "", actions: [], createdAt, expiresAt: NOW + H });
  const v = visible({ v: 1, at: NOW, items: [mk("l", "low", 3), mk("n", "normal", 1), mk("h", "high", 0), mk("n2", "normal", 2)] }, NOW);
  assert.deepEqual(v.map((x) => x.key), ["h", "n2", "n", "l"]);
});
