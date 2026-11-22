// Efficiency pass 2: STUDIO job cache + ETag, /api/agents counts, scheduler event/resume gates, Mission Control in one request,
// conditional feed downloads. Each keeps behaviour identical and has an env switch (see the module headers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createJobCache, etagFor, etagMatches, stampOf } from "../src/lib/clips/job-cache-pure.ts";
import { agentStat, countTasks } from "../src/lib/agent-counts-pure.ts";
import { claimSkip, resumeSkip } from "../src/lib/scheduler-gate-pure.ts";
import { conditionalHeaders, validatorsFrom } from "../src/lib/feed-cache-pure.ts";
import { bridgeStudio, studioSummary } from "../src/lib/mission-pure.ts";
import { shownJobs } from "../src/lib/clips/pure.ts";

const read = (f: string) => readFileSync(path.join(import.meta.dirname, "..", f), "utf8").replace(/\r\n/g, "\n"); // Windows checkouts may be CRLF

test("EFF2-1: the job cache serves a file only while its stamp is unchanged and forgets deleted files", () => {
  const c = createJobCache<{ id: string }>();
  const s = stampOf({ mtimeMs: 10, size: 100, ino: 7n });
  c.set("a", s, { id: "a" });
  assert.deepEqual(c.get("a", { mtimeMs: 10, size: 100, ino: 7 }), { id: "a" });
  assert.equal(c.get("a", { mtimeMs: 11, size: 100, ino: 7 }), undefined, "rewritten");
  assert.equal(c.get("a", { mtimeMs: 10, size: 101, ino: 7 }), undefined, "same tick, other size");
  assert.equal(c.get("a", { mtimeMs: 10, size: 100, ino: 8 }), undefined, "replaced by rename");
  c.set("b", s, { id: "b" }); c.keepOnly(["b"]);
  assert.equal(c.size, 1);
  c.drop("b"); assert.equal(c.size, 0);
  const f = read("src/lib/clips/factory.ts");
  assert.match(f, /await rename\(tmp, file\); JC\.drop\(id\);/, "this process's own saves drop the entry");
  assert.match(f, /o\.shared \? hit : structuredClone\(hit\)/, "callers that may change a job get a copy");
  assert.match(f, /ORBIT_JOB_CACHE !== "0"/);
});

test("EFF2-1: clip list ETag: same body same tag; If-None-Match lists and weak forms match; the off switch exists", () => {
  const t = etagFor("ab".repeat(20));
  assert.equal(t, `"${"ab".repeat(16)}"`);
  assert.ok(etagMatches(t, t) && etagMatches(`W/${t}, "x"`, t) && etagMatches("*", t));
  assert.ok(!etagMatches(null, t) && !etagMatches('"other"', t));
  const r = read("src/app/api/studio/clips/route.ts");
  assert.match(r, /status: 304/); assert.match(r, /ORBIT_CLIPS_ETAG === "0"/);
  assert.match(read("src/components/ClipFactory.tsx"), /etagJson<Data/);
  const jobs = Array.from({ length: 35 }, (_, i) => ({ id: `j${i}`, status: i === 33 ? "rendering" : "done", clips: i === 34 ? [{ status: "ready" }] : [] }));
  assert.deepEqual(shownJobs(jobs).map((j) => j.id), [...Array.from({ length: 30 }, (_, i) => `j${i}`), "j33", "j34"], "same list as before");
});

test("EFF2-2: grouped agent counts give exactly the stats the row scan gave", () => {
  const rows = [
    { agent: "nova", status: "running", title: "a" }, { agent: "nova", status: "done", title: "b" }, { agent: "nova", status: "awaiting_approval", title: "c" },
    { agent: "nova", status: "running", title: "Team: launch" }, { agent: "atlas", status: "failed", title: null }, { agent: "atlas", status: "done", title: "x" },
  ];
  const old = (slug: string) => { // the route's previous per-row code
    const t = rows.filter((x) => x.agent === slug && !String(x.title).startsWith("Team: "));
    return { running: t.filter((x) => x.status === "running").length, done: t.filter((x) => x.status === "done" || x.status === "awaiting_approval").length, failed: t.filter((x) => x.status === "failed").length };
  };
  const usageRows = [{ purpose: "agent.nova", input_tokens: 10, output_tokens: 5 }, { purpose: "agent.nova", input_tokens: 1, output_tokens: 1 }];
  const sqlLike = [{ agent: "nova", status: "running", n: "1" }, { agent: "nova", status: "done", n: 1 }, { agent: "nova", status: "awaiting_approval", n: 1 }, { agent: "atlas", status: "failed", n: 1 }, { agent: "atlas", status: "done", n: 1 }];
  const totals = [{ model: "sonnet", purpose: "agent.nova", calls: "2", input_tokens: "11", output_tokens: "6" }];
  for (const slug of ["nova", "atlas", "pulse"]) {
    const want = { ...old(slug), calls: slug === "nova" ? 2 : 0, tokens: slug === "nova" ? 17 : 0 };
    assert.deepEqual(agentStat(slug, countTasks(rows, "Team: "), usageRows.map((u) => ({ ...u, calls: 1 }))), want, `scan fallback ${slug}`);
    assert.deepEqual(agentStat(slug, sqlLike, totals), want, `grouped ${slug}`);
  }
  const sql = read("supabase/migrations/0028_agent_task_counts.sql");
  assert.match(sql, /security invoker/); assert.match(sql, /auth\.uid\(\)/); assert.match(sql, /coalesce\(t\.title, ''\) not like 'Team: %'/);
  assert.match(read("src/app/api/agents/route.ts"), /ORBIT_AGENT_COUNTS === "0"/);
});

test("EFF2-3: event claims are skipped only when the id > cursor query would return nothing", () => {
  const t = { done: [] as number[], inflight: {} as Record<string, number> };
  assert.equal(claimSkip(50, 50, t), true);
  assert.equal(claimSkip(50, 40, t), true);
  assert.equal(claimSkip(50, 51, t), false, "a newer event");
  assert.equal(claimSkip(50, null, t), false, "latest unknown");
  assert.equal(claimSkip(undefined, 50, t), false, "first run");
  assert.equal(claimSkip(50, 50, { ...t, inflight: { 51: 1 } }), false, "something in flight");
  assert.equal(claimSkip(50, 50, { ...t, done: [52] }), false);
  assert.equal(claimSkip(50, 50, { ...t, retry: [9] }), false, "owner Retry waiting");
  const d = read("src/lib/durable.ts");
  assert.match(d, /ORBIT_EVENTS_GATE !== "0" && claimSkip\(/);
  assert.match(d, /if \(!c \|\| now - c\.at > 30_000 \|\| now < c\.at \|\| eventsDirtyAt\(\) >= c\.at\) return read\(\);/, "shared only inside a tick, never after an emit");
  const sc = read("src/lib/scheduler.ts");
  assert.ok(sc.indexOf("eventsTick();") < sc.indexOf("await handleEvents(sb)") && /finally \{\n\s+endEventsTick\(\);/.test(sc));
  assert.match(read("src/lib/claude.ts"), /markEventsDirty\(\); \/\/ scheduler gates/);
});

test("EFF2-3: resume passes that found nothing wait for a write, an event or 10 minutes", () => {
  const m = { at: 1000, empty: true };
  assert.equal(resumeSkip(m, 0, 2000), true);
  assert.equal(resumeSkip(m, 1500, 2000), false, "a writer/emit ran after the empty pass");
  assert.equal(resumeSkip(m, 0, 1000 + 10 * 60_000), false, "max age");
  assert.equal(resumeSkip({ at: 1000, empty: false }, 0, 2000), false, "found rows: run every tick");
  assert.equal(resumeSkip(undefined, 0, 2000), false);
  assert.equal(resumeSkip(m, 0, 500), false, "clock went back");
  const s = read("src/lib/scheduler.ts");
  for (const k of ["chains", "goals", "missions"]) assert.match(s, new RegExp(`idleGated\\(\`${k}:`));
  assert.match(s, /ORBIT_RESUME_GATE !== "0"/);
  for (const f of ["src/lib/missions.ts", "src/lib/goals.ts", "src/lib/chains.ts"]) assert.match(read(f), /markResumeDirty\(\)/, f);
});

test("EFF2-4: Mission Control's one request carries what the five did; studio keeps what bridgeStudio reads", () => {
  const jobs = [{ id: "j", source: "a.mp4", status: "rendering", step: "Cutting", progress: 0.5, warnings: ["x"], options: {},
    clips: [{ id: "c", status: "ready", title: "T", words: [1, 2, 3], publish: { status: "scheduled", scheduledFor: "2999-01-01T00:00:00Z", title: "P", videoId: "v" } }] }];
  const now = Date.parse("2026-11-21T00:00:00Z");
  assert.deepEqual(bridgeStudio(studioSummary(jobs), now), bridgeStudio({ jobs }, now));
  assert.ok(!JSON.stringify(studioSummary(jobs)).includes("words"), "smaller payload");
  const mc = read("src/components/MissionControl.tsx");
  assert.match(mc, /get\("\/api\/mission"\)/); assert.match(mc, /one\.off/, "falls back to the separate requests");
  assert.match(read("src/app/api/mission/route.ts"), /ORBIT_MISSION_COMBINED === "0"/);
});

test("EFF2-5: feed validators: remembered only when offered, sent back as conditional headers", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
  assert.equal(validatorsFrom(h({}), 3, null), null);
  assert.deepEqual(validatorsFrom(h({ etag: 'W/"abc"' }), 3, "T"), { etag: 'W/"abc"', items: 3, title: "T" });
  assert.deepEqual(validatorsFrom(h({ "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT" }), 0, null), { lastModified: "Wed, 21 Oct 2026 07:28:00 GMT", items: 0, title: null });
  assert.equal(validatorsFrom(h({ "last-modified": "not a date" }), 1, null), null);
  assert.equal(validatorsFrom(h({ etag: '"a"\r\nX: y' }), 1, null), null, "no header injection");
  assert.deepEqual(conditionalHeaders(undefined), {});
  assert.deepEqual(conditionalHeaders({ etag: '"a"', lastModified: "Wed, 21 Oct 2026 07:28:00 GMT", items: 1, title: null }), { "If-None-Match": '"a"', "If-Modified-Since": "Wed, 21 Oct 2026 07:28:00 GMT" });
  const p = read("src/lib/pulse.ts");
  assert.match(p, /ORBIT_FEED_CONDITIONAL !== "0"/);
  assert.match(p, /\/\/ only after the items are stored/, "validators are saved only after a successful ingest");
  assert.match(read("src/lib/memory.ts"), /r\.status === 304 && o\.allow304/);
});

test("EFF2: clips.find stays on its model (not moved to Haiku)", () => {
  const f = read("src/lib/clips/factory.ts");
  const at = f.indexOf('"clips.find"');
  assert.ok(at > 0);
  assert.ok(!/FAST_MODEL/.test(f.slice(Math.max(0, at - 600), at + 200)), "clips.find must not use the fast model");
});
