// Reliability sweep (Nov 2026): slow CORE prep, jobs after wake-up without internet, Ollama start, Scrapling helper limits.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countedBriefFailures, isNetworkError, NET_MAX_TRIES, netBackoff, netEdge, netRetryDue, pickNetRetries, probeHosts, selfTestRerun } from "../src/lib/net-wait-pure.ts";
import { COLD_EMBED_MS, lateLine, prepBudget, PREP_BUDGET_MS, withBudget } from "../src/lib/prep-budget-pure.ts";
import { retrieveMemories } from "../src/lib/memory-search.ts";
import { makeStamp, stampCovers, type ModelFileSpec } from "../src/lib/embeddings-pure.ts";
import { alertingGroups, failureGroups } from "../src/lib/clips/failure-alert-pure.ts";
import { ollamaCheck, ollamaExeCandidates, ollamaLaunch, ollamaRetryMs, ollamaWanted } from "../src/lib/ollama-start-pure.ts";
import { helperFailure, helperLimits } from "../src/lib/scrape-pure.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NOW = Date.parse("2026-11-22T09:00:00Z");

/* ---------- 1. CORE prep budget ---------- */

test("withBudget: a fast step passes through, a slow one gives the fallback at the budget, errors still reject", async () => {
  assert.equal(await withBudget(Promise.resolve(7), 50, 0), 7);
  let late = 0;
  const t0 = Date.now();
  assert.equal(await withBudget(sleep(10_000).then(() => 1), 60, -1, () => late++), -1);
  assert.ok(Date.now() - t0 < 1_000 && late === 1);
  await assert.rejects(withBudget(Promise.reject(new Error("db down")), 100, 0), /db down/);
  assert.equal(await withBudget(sleep(30).then(() => 2), 0, -1), 2, "0 = no budget");
});

test("prepBudget reads ORBIT_PREP_BUDGET_MS (default 2.5 s, 0 = off, junk = default, capped at 60 s)", () => {
  assert.equal(prepBudget(undefined), PREP_BUDGET_MS);
  assert.equal(prepBudget(""), PREP_BUDGET_MS);
  assert.equal(prepBudget("0"), 0);
  assert.equal(prepBudget("800"), 800);
  assert.equal(prepBudget("soon"), PREP_BUDGET_MS);
  assert.equal(prepBudget("-5"), PREP_BUDGET_MS);
  assert.equal(prepBudget("999999"), 60_000);
  assert.equal(lateLine([], 2500), "");
  assert.equal(lateLine(["memory", "chats", "memory"], 2500), "chats, memory took over 2.5 s; answered without them");
  assert.equal(lateLine(["facts"], 2500), "facts took over 2.5 s; answered without it");
});

type Row = { id: string; kind?: string; title: string; content: string };
function store(rows: Row[], fts: string[]) {
  const client = {
    from() {
      const c: { ids?: string[] } = {};
      const b = {
        select() { return b; }, eq() { return b; }, or() { return b; }, order() { return b; }, limit() { return b; }, neq() { return b; }, textSearch() { return b; },
        in(_k: string, ids: string[]) { c.ids = ids; return b; },
        then(res: (x: unknown) => unknown) { return Promise.resolve({ data: c.ids ? rows.filter((r) => c.ids!.includes(r.id)) : fts.map((id) => ({ id })), error: null }).then(res); },
      }; return b;
    },
    rpc() { return Promise.resolve({ data: [], error: null }); },
  };
  return client as unknown as SupabaseClient;
}

test("harness: a cold embedding model (4 s here, ~10 s on the laptop) no longer holds memory search; keyword hits still come back within the cold budget", async () => {
  const rows: Row[] = [{ id: "a", kind: "note", title: "Pet sim DataStore", content: "write queue" }];
  const coldEmbed = (_t: string, _k: "query") => sleep(4_000).then(() => [0.1]);
  const before = Date.now();
  const slow = retrieveMemories(store(rows, ["a"]), "datastore", 8, "u", coldEmbed); // the old path: waits for the vector
  const raced = await Promise.race([slow.then(() => "done"), sleep(1_500).then(() => "still waiting")]);
  assert.equal(raced, "still waiting", "without a budget the search waits on the model");
  const t0 = Date.now();
  const quick = (t: string, k: "query") => withBudget(coldEmbed(t, k), COLD_EMBED_MS, null);
  const out = await retrieveMemories(store(rows, ["a"]), "datastore", 8, "u", quick);
  const took = Date.now() - t0;
  console.log(`  cold-embed search: ${took} ms with the budget (was ≥ 4000 ms; waited ${t0 - before} ms above just to show it)`);
  assert.ok(took < COLD_EMBED_MS + 400, `took ${took} ms`);
  assert.deepEqual(out.results.map((m) => m.id), ["a"]);
  assert.equal(out.mode, "fulltext");
});

test("verified stamp: unchanged model files skip the 309 MB re-hash; any change, a new expected hash or a missing file hashes again", () => {
  const specs: ModelFileSpec[] = [{ relPath: "onnx/m.onnx", size: 10, sha256: "AB" }, { relPath: "onnx/m.onnx_data", size: 20, sha256: "cd" }];
  const files = { "onnx/m.onnx": { size: 10, mtimeMs: 1, ctimeMs: 2 }, "onnx/m.onnx_data": { size: 20, mtimeMs: 3, ctimeMs: 4 } };
  const stamp = makeStamp(files, specs);
  assert.equal(stampCovers(stamp, files, specs), true);
  assert.equal(stampCovers(JSON.parse(JSON.stringify(stamp)), files, specs), true, "survives the JSON file");
  assert.equal(stampCovers(stamp, { ...files, "onnx/m.onnx_data": { size: 20, mtimeMs: 9, ctimeMs: 4 } }, specs), false, "rewritten");
  assert.equal(stampCovers(stamp, { ...files, "onnx/m.onnx": null }, specs), false, "missing");
  assert.equal(stampCovers(stamp, files, [{ ...specs[0], sha256: "ff" }, specs[1]]), false, "new expected hash");
  assert.equal(stampCovers(stamp, { ...files, "onnx/m.onnx": { size: 11, mtimeMs: 1, ctimeMs: 2 } }, specs), false, "size");
  assert.equal(stampCovers(null, files, specs), false);
  assert.equal(stampCovers("junk", files, specs), false);
});

/* ---------- 2. no internet after wake-up ---------- */

test("isNetworkError: DNS/connect failures yes; refusals, 403s and tool errors no", () => {
  for (const m of ["getaddrinfo ENOTFOUND abc.supabase.co", "TypeError: fetch failed", "connect ENETUNREACH 1.2.3.4:443", "EAI_AGAIN api.anthropic.com",
    "all feeds failed (fetch failed)", "ERROR: [youtube] x: Unable to download API page: <urlopen error [Errno 11001] getaddrinfo failed>", "Could not resolve host: twitch.tv", "Temporary failure in name resolution"])
    assert.equal(isNetworkError(m), true, m);
  for (const m of ["The site answered 403", "yt-dlp not found", "This video is private.", "Claude usage limit reached", "", "Skipped: not English"])
    assert.equal(isNetworkError(m), false, m);
  const e = Object.assign(new TypeError("fetch failed"), {});
  assert.equal(isNetworkError(e), true);
  assert.equal(isNetworkError(Object.assign(new Error("boom"), { cause: { code: "ENOTFOUND" } })), true, "cause code");
  assert.equal(isNetworkError(undefined), false);
});

test("netRetryDue: backoff 30 s → 10 min, then gives up after the cap; old failures don't count", () => {
  assert.equal(netRetryDue([], NOW), true);
  assert.equal(netRetryDue([NOW - 10_000], NOW), false, "30 s wait after the first");
  assert.equal(netRetryDue([NOW - 31_000], NOW), true);
  assert.equal(netRetryDue([NOW - 200_000, NOW - 50_000], NOW), false, "1 min after the second");
  assert.equal(netRetryDue([NOW - 200_000, NOW - 61_000], NOW), true);
  assert.equal(netRetryDue(Array.from({ length: NET_MAX_TRIES }, (_, i) => NOW - 3_600_000 + i), NOW), false, "cap");
  assert.equal(netRetryDue([NOW - 7 * 3_600_000], NOW), true, "outside the window");
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(netBackoff), [30_000, 60_000, 120_000, 300_000, 600_000, 600_000]);
});

test("briefings: a morning brief that failed on no internet doesn't count as ran (retries), a real failure still does", () => {
  const net = { detail: "morning: all feeds failed (getaddrinfo ENOTFOUND feeds.bbci.co.uk)", started_at: new Date(NOW - 120_000).toISOString() };
  const real = { detail: "evening: Claude answered with an empty briefing", started_at: new Date(NOW - 120_000).toISOString() };
  assert.deepEqual(countedBriefFailures([net, real], NOW), [real]);
  const five = Array.from({ length: 5 }, (_, i) => ({ ...net, started_at: new Date(NOW - (i + 1) * 900_000).toISOString() }));
  assert.equal(countedBriefFailures(five, NOW).length, 5, "after the cap they count again: no retry loop");
  assert.deepEqual(countedBriefFailures([{ ...net, started_at: new Date(NOW - 5_000).toISOString() }], NOW).length, 1, "inside the backoff it still counts");
});

test("automation tasks that failed on the network go back in the queue; never one with a resolved action, sub-tasks or a team", () => {
  const at = new Date(NOW - 60_000).toISOString();
  const base = { error: "getaddrinfo ENOTFOUND api.anthropic.com", finished_at: at, title: "⚙ Daily business loop", pending: [] };
  const rows = [
    { id: "net", ...base },
    { id: "real", ...base, error: "The model refused" },
    { id: "done-action", ...base, pending: [{ status: "done" }] },
    { id: "kids", ...base, children: 2 },
    { id: "team", ...base, title: "Team: launch" },
    { id: "fresh", ...base, finished_at: new Date(NOW - 5_000).toISOString() },
    { id: "old", ...base, finished_at: new Date(NOW - 8 * 3_600_000).toISOString() },
  ];
  assert.deepEqual(pickNetRetries(rows, new Map(), NOW), ["net"]);
  assert.deepEqual(pickNetRetries(rows, new Map([["net", [1, 2, 3, 4, 5]]]), NOW), [], "cap");
  assert.deepEqual(pickNetRetries([{ ...rows[0], finished_at: new Date(NOW - 45_000).toISOString() }], new Map([["net", [1]]]), NOW), [], "second retry waits 1 min");
});

test("probe hosts, edges and the boot self-test re-run", () => {
  assert.deepEqual(probeHosts("https://abc.supabase.co"), ["abc.supabase.co"]);
  assert.deepEqual(probeHosts("http://127.0.0.1:54321"), ["api.anthropic.com"]);
  assert.deepEqual(probeHosts(undefined), ["api.anthropic.com"]);
  assert.deepEqual([netEdge(null, true), netEdge(null, false), netEdge(true, false), netEdge(false, true), netEdge(true, true)], [null, "down", "down", "up", null]);
  const ok = [{ status: "ok", detail: "Reachable" }];
  assert.equal(selfTestRerun(true, true, ok), false);
  assert.equal(selfTestRerun(false, true, ok), true, "waited 60 s without network");
  assert.equal(selfTestRerun(true, false, ok), true, "offline after the run");
  assert.equal(selfTestRerun(true, true, [{ status: "fail", detail: "Couldn't reach the database" }]), true);
  assert.equal(selfTestRerun(true, true, [{ status: "warn", detail: "Not set: STUDIO stats are off" }]), false, "a real warning doesn't re-run");
});

test("STUDIO: a download that failed on no internet stays in the Failed list but never turns the alert red", () => {
  const now = NOW, at = new Date(now - 60_000).toISOString();
  const data = { downloads: [
    { id: "d1", status: "failed", url: "https://youtu.be/aaaaaaaaaaa", error: "ERROR: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>", createdAt: at },
    { id: "d2", status: "failed", url: "https://youtu.be/bbbbbbbbbbb", error: "This video is private.", createdAt: at },
  ] };
  assert.equal(failureGroups(data).length, 2, "both listed");
  assert.deepEqual(alertingGroups(data, [], now).map((g) => g.download?.id), ["d2"], "only the real one alerts");
});

/* ---------- 3. Ollama ---------- */

test("Ollama: where ORBIT looks for it, when it's wanted, and the plain Doctor line", () => {
  assert.deepEqual(ollamaExeCandidates({ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local", ProgramFiles: "C:\\Program Files" }, "win32"),
    ["C:\\Users\\a\\AppData\\Local\\Programs\\Ollama\\ollama.exe", "C:\\Program Files\\Ollama\\ollama.exe", "ollama"]);
  assert.equal(ollamaExeCandidates({ ORBIT_OLLAMA_EXE: "D:\\o\\ollama.exe" }, "win32")[0], "D:\\o\\ollama.exe");
  assert.deepEqual(ollamaExeCandidates({}, "linux"), ["/usr/local/bin/ollama", "/usr/bin/ollama", "ollama"]);
  assert.equal(ollamaWanted("", false), false);
  assert.equal(ollamaWanted("qwen3.5:9b", false), true);
  assert.equal(ollamaWanted("", true), true);
  assert.equal(ollamaCheck({ state: "running" }).status, "ok");
  assert.match(ollamaCheck({ state: "started", at: NOW, ms: 4200 }).detail, /ORBIT started it \(ready in 4 s\)/);
  const miss = ollamaCheck({ state: "missing" });
  assert.equal(miss.status, "warn"); assert.match(miss.fix ?? "", /setup\.ps1/);
  const bad = ollamaCheck({ state: "failed", at: NOW, why: "it didn't answer at http://127.0.0.1:11434 within 20 s" });
  assert.equal(bad.status, "fail"); assert.match(bad.detail, /couldn't start it: it didn't answer/);
  assert.equal(ollamaCheck({ state: "off" }).status, "warn");
  assert.equal(ollamaCheck({ state: "unused" }).status, "ok");
});

/* ---------- 4. Scrapling helper ---------- */

test("Scrapling helper: one try that ends before ORBIT's own limit; a timeout or a page error never switches the rung off", () => {
  assert.deepEqual(helperLimits("fast", 15_000), { killMs: 15_000, requestS: 11, retries: 1 });
  assert.deepEqual(helperLimits("fast"), { killMs: 30_000, requestS: 20, retries: 1 });
  assert.equal(helperLimits("fast", 5_000).requestS, 3, "floor");
  assert.equal(helperLimits("browser").requestS, 60);
  const proxyNoise = "[2026-11-22 16:19:06] WARNING: Proxy 'None' failed (attempt 1) | Retrying in 1 seconds...\n";
  const killed = helperFailure(null, "SIGTERM", proxyNoise, 15_000);
  assert.deepEqual(killed, { error: "the page took longer than 15 s and was stopped", unavailable: false });
  assert.ok(!/Proxy|helper exited/.test(killed.error));
  const crash = helperFailure(1, null, `${proxyNoise}Traceback...\nValueError: bad page`, 15_000);
  assert.equal(crash.unavailable, false); assert.match(crash.error, /exit 1\).*ValueError/); assert.ok(!/Proxy 'None'/.test(crash.error));
  const missing = helperFailure(1, null, "ModuleNotFoundError: No module named 'scrapling'", 15_000);
  assert.equal(missing.unavailable, true); assert.match(missing.error, /isn't installed/);
});

test("ollama on Windows never opens a console window: tray app if present, else attached serve", () => {
  const exe = "C:\\Users\\a\\AppData\\Local\\Programs\\Ollama\\ollama.exe";
  assert.deepEqual(ollamaLaunch(exe, "win32", () => true), { file: "C:\\Users\\a\\AppData\\Local\\Programs\\Ollama\\ollama app.exe", args: [], detached: true });
  assert.deepEqual(ollamaLaunch(exe, "win32", () => false), { file: exe, args: ["serve"], detached: false });
  assert.deepEqual(ollamaLaunch("ollama", "win32", () => true), { file: "ollama", args: ["serve"], detached: false });
  assert.deepEqual(ollamaLaunch("/usr/bin/ollama", "linux", () => true), { file: "/usr/bin/ollama", args: ["serve"], detached: true });
  assert.deepEqual([1, 2, 3, 9].map(ollamaRetryMs), [60_000, 300_000, 1_800_000, 1_800_000]);
});
