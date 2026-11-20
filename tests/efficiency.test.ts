// Efficiency pass (Nov 2026): caches, scheduler gates, GPU keep-warm and hidden-tab polling. Pure parts + source checks of the wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTtlCache, envOn } from "../src/lib/ttl-cache-pure.ts";
import { briefingsSkip, proposalsSkip, skipRead, sweepDue } from "../src/lib/scheduler-gate-pure.ts";
import { busyWith, emptyGpu, keepWarm, type GpuState } from "../src/lib/gpu-lock-pure.ts";
import { dueSlots } from "../src/lib/pure.ts";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("ttl cache: hit, expiry, LRU bound, failures not kept, in-flight shared", async () => {
  let t = 0;
  const c = createTtlCache<number | null>({ max: 2, ttlMs: 100, now: () => t });
  let runs = 0;
  const run = (v: number | null) => () => { runs++; return new Promise<number | null>((r) => setTimeout(() => r(v), 2)); };
  const [a, b] = await Promise.all([c.memo("x", run(1)), c.memo("x", run(9))]);
  assert.equal(a, 1); assert.equal(b, 1); assert.equal(runs, 1); // one call for two asks
  assert.equal(await c.memo("x", run(2)), 1); assert.equal(runs, 1); // cached
  t = 100; assert.equal(await c.memo("x", run(3)), 3); assert.equal(runs, 2); // expired → fresh
  assert.equal(await c.memo("n", run(null)), null); assert.equal(await c.memo("n", run(4)), 4); assert.equal(runs, 4); // a null is retried
  c.set("y", 5); c.get("x"); c.set("z", 6); // n is least recent → dropped (max 2)
  assert.equal(c.size, 2); assert.equal(c.get("n"), undefined); assert.equal(c.get("z"), 6);
  await assert.rejects(c.memo("e", () => Promise.reject(new Error("boom")))); assert.equal(c.get("e"), undefined);
});

test("envOn: on unless 0/off/false/no", () => {
  for (const v of [undefined, "", "1", "on", "yes"]) assert.equal(envOn(v), true, String(v));
  for (const v of ["0", "off", "FALSE", "no", " 0 "]) assert.equal(envOn(v), false, v);
});

test("scheduler gates never skip a read the database could answer differently", () => {
  const now = new Date(2026, 10, 21, 10, 0); // 10:00: morning (07:30) slot due unless it ran today
  const ranToday = { morning: new Date(2026, 10, 21, 7, 31).toISOString() };
  // the remembered runs say nothing is due → skip (the real rows are at least as new)
  assert.equal(dueSlots(now, ranToday).length, 0);
  assert.equal(briefingsSkip({ value: ranToday, at: now.getTime() - 60_000 }, now), true);
  // a slot looks due with the remembered runs → read the database
  assert.equal(briefingsSkip({ value: {}, at: now.getTime() - 60_000 }, now), false);
  // nothing remembered, too old (30 min) or a clock jump back → read
  assert.equal(briefingsSkip(undefined, now), false);
  assert.equal(briefingsSkip({ value: ranToday, at: now.getTime() - 31 * 60_000 }, now), false);
  assert.equal(briefingsSkip({ value: ranToday, at: now.getTime() + 60_000 }, now), false);
  // 12:30 midday slot arrives: the same remembered runs now say "due" → read
  assert.equal(briefingsSkip({ value: ranToday, at: new Date(2026, 10, 21, 12, 29).getTime() }, new Date(2026, 10, 21, 12, 31)), false);
  const H = 3_600_000, n = 10 * H;
  assert.equal(proposalsSkip({ value: n - 2 * H, at: n - 60_000 }, n, 6 * H), true);
  assert.equal(proposalsSkip({ value: n - 6 * H, at: n - 60_000 }, n, 6 * H), false); // due by the old copy → real read
  assert.equal(proposalsSkip({ value: 0, at: n - 60_000 }, n, 6 * H), false);
  assert.equal(skipRead({ value: 1, at: 0 }, 10, 100, () => true), true);
  assert.equal(sweepDue(undefined, 5, 10), true); assert.equal(sweepDue(0, 5, 10), false); assert.equal(sweepDue(0, 10, 10), true); assert.equal(sweepDue(20, 5, 10), true);
});

test("GPU keep-warm only when the very next waiter is the same kind", () => {
  const w = (kind: "music" | "video" | "image", id: string) => ({ id, kind, since: 0, deadline: 1e12, ttl: 1 });
  const s: GpuState = { ...emptyGpu(), holders: [{ id: "m1", kind: "music", since: 0, until: 1e12, ttl: 1 }], queue: [w("music", "m2"), w("image", "i1")] };
  assert.equal(keepWarm(s, "music"), true);
  assert.equal(keepWarm(s, "music", false), false); // ORBIT_GPU_KEEP_WARM=0
  assert.equal(keepWarm({ ...s, queue: [w("image", "i1"), w("music", "m2")] }, "music"), false); // a picture is next: free first
  assert.equal(keepWarm({ ...s, queue: [] }, "music"), false);
  assert.equal(busyWith(s, "image"), true); assert.equal(busyWith({ ...s, queue: [] }, "video"), false);
  for (const f of ["src/lib/music-gen.ts", "src/lib/video.ts"]) assert.match(src(f), /unloadUnlessNext\("(music|video)"/, f);
});

test("wiring: query embeddings and article text are cached, long agent reads stay live", () => {
  const e = src("src/lib/embeddings.ts");
  assert.match(e, /inputType !== "query" \|\| !envOn\(process\.env\.ORBIT_EMBED_CACHE\)\) return embedNow/); // documents never cached
  assert.match(e, /createHash\("sha256"\)/); // keyed by a hash, the text isn't kept as a key
  const n = src("src/lib/news.ts");
  assert.match(n, /maxChars > 4000 \|\| !envOn\(process\.env\.ORBIT_ARTICLE_CACHE\)\) return readArticleNow/);
  assert.match(src("src/lib/clips/factory.ts"), /v\.ffmpeg && v\.transcriber && v\.ytdlp && !v\.whisperErr \? \{ at: now, v \} : undefined/); // only all-OK is reused
});

test("journal rows never reach the briefing or proposals prompts", () => {
  assert.match(src("src/lib/pulse.ts"), /wantsMemories \? await sb\.from\("memories"\)[^\n]*\.neq\("kind", "journal"\)/);
  assert.match(src("src/lib/proactive.ts"), /from\("memories"\)\.select\("title, kind, content, tags, created_at"\)\.eq\("user_id", userId\)\.neq\("kind", "journal"\)/);
});

test("scheduler: gates have the kill switch and approvals still expire (every 10 min)", () => {
  const s = src("src/lib/scheduler.ts");
  assert.match(s, /ORBIT_SCHED_GATES !== "0"/);
  assert.match(s, /sweepDue\(expiryAt\.get\(id\), Date\.now\(\), EXPIRY_MS\)\) \{ expiryAt\.set\(id, Date\.now\(\)\); void import\("\.\/approval-expiry"\)/);
  assert.match(s, /briefingsSkip\(briefLast\.get\(id\), new Date\(\)\)/);
  assert.match(src("src/lib/proactive.ts"), /proposalsSkip\(lastSeen\.get\(userId\), t, SCHEDULE_EVERY_MS\)/);
});

test("pollers skip ticks while the tab is hidden", () => {
  for (const f of ["src/components/AgentsPanels.tsx", "src/components/RulesView.tsx", "src/components/ActivityView.tsx", "src/components/Orbit.tsx", "src/components/NewsGlobe.tsx", "src/components/FollowingSection.tsx", "src/components/alien/Comets.tsx"]) {
    const s = src(f);
    assert.doesNotMatch(s, /setInterval\(\(\) => void load\(\), (5000|10_000|45_000)\)/, f);
    assert.doesNotMatch(s, /setInterval\((load|get), (20_000|REFRESH_MS|5 \* 60_000|10 \* 60_000)\)/, f);
  }
});
