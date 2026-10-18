import { test } from "node:test";
import assert from "node:assert/strict";
import { D7, H5, LIMIT_PAUSE_MS, MAX_RESET_MS, addCall, isLimitAnswer, emptyMeter, holdReason, parseLimitError, parseMeter, patchSettings, usageLevel, windowStats, type Call } from "../src/lib/usage-meter-pure.ts";
import { parseStreamJsonLine } from "../src/lib/streamjson.ts";

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime(); // local time: reset times are this PC's clock
const call = (ago: number, purpose = "core", inTok = 100, outTok = 50): Call => ({ at: NOW - ago, purpose, model: "sonnet", inTok, outTok, ms: 1000, ok: true });

test("windowStats counts the rolling 5 h and 7 day windows, grouped by purpose", () => {
  const calls = [call(1000, "core"), call(H5 - 1, "agent.atlas"), call(H5 + 1, "agent.nova"), call(D7 - 1, "goals.plan"), call(D7 + 1, "core")];
  const h5 = windowStats(calls, NOW, H5), d7 = windowStats(calls, NOW, D7);
  assert.equal(h5.calls, 2);
  assert.equal(h5.tokens, 300);
  assert.deepEqual(h5.byPurpose, { core: { calls: 1, tokens: 150 }, agent: { calls: 1, tokens: 150 } });
  assert.equal(d7.calls, 4);
});

test("addCall prunes calls older than 7 days", () => {
  const m = emptyMeter();
  m.calls = [call(D7 + 5)];
  addCall(m, call(0), NOW);
  assert.equal(m.calls.length, 1);
});

test("usageLevel / holdReason: heavy at warnPct of the calls or token budget, a live limit always holds", () => {
  const m = emptyMeter();
  m.settings = { calls5h: 10, tokens5h: 0, warnPct: 80 };
  m.calls = Array.from({ length: 7 }, () => call(60_000));
  assert.deepEqual(usageLevel(m, NOW), { pct: 70, heavy: false });
  assert.equal(holdReason(m, NOW), "");
  m.calls.push(call(60_000));
  assert.equal(usageLevel(m, NOW).heavy, true);
  assert.match(holdReason(m, NOW), /^Heavy use: 80%/);
  m.calls = [call(60_000, "core", 900, 0)];
  m.settings.tokens5h = 1000; // 900/1000 tokens = 90 % even with 1 call
  assert.equal(usageLevel(m, NOW).pct, 90);
  m.calls = [];
  m.limit = { until: NOW + 60_000, at: NOW, text: "limit" };
  assert.match(holdReason(m, NOW), /^Claude usage limit reached until/);
  m.limit.until = NOW - 1; // reset passed
  assert.equal(holdReason(m, NOW), "");
});

test("parseLimitError reads the CLI's limit messages", () => {
  const epoch = Math.floor(NOW / 1000) + 3600;
  assert.equal(parseLimitError(`Claude AI usage limit reached|${epoch}`, NOW), epoch * 1000);
  assert.equal(parseLimitError("Claude AI usage limit reached|1000000000", NOW), NOW + 60_000); // a past reset still pauses briefly
  assert.equal(parseLimitError(`Claude AI usage limit reached|${epoch + 30 * 86400}`, NOW), NOW + MAX_RESET_MS); // capped at 8 days
  const three = parseLimitError("5-hour limit reached ∙ resets 3pm", NOW)!;
  assert.equal(new Date(three).getHours(), 15);
  assert.equal(new Date(three).getDate(), 18);
  const nine = parseLimitError("You've hit your limit · resets 9am (Europe/Tallinn)", NOW)!; // 9am already passed today → tomorrow
  assert.equal(new Date(nine).getDate(), 19);
  assert.equal(new Date(nine).getHours(), 9);
  const mon = parseLimitError("Weekly limit reached ∙ resets Mon 10am", NOW)!; // 2026-10-18 is a Sunday
  assert.equal(new Date(mon).getDay(), 1);
  assert.equal(new Date(mon).getDate(), 19);
  assert.equal(new Date(parseLimitError("Your limit will reset at 15:30", NOW)!).getMinutes(), 30);
  assert.equal(parseLimitError('API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}', NOW), NOW + LIMIT_PAUSE_MS);
  assert.equal(parseLimitError("Claude Code timed out after 2 minutes", NOW), null);
  assert.equal(parseLimitError("Summarised 429 tokens of rate limits policy", NOW), null); // tightened: no bare 429 / "rate limit"
  assert.equal(parseLimitError("", NOW), null);
});

test("patchSettings / parseMeter validate and never throw", () => {
  const cur = emptyMeter().settings;
  assert.deepEqual(patchSettings({ calls5h: 300, warnPct: 90 }, cur), { ...cur, calls5h: 300, warnPct: 90 });
  assert.equal(typeof patchSettings({ calls5h: 0 }, cur), "string");
  assert.equal(typeof patchSettings({ warnPct: "80" }, cur), "string");
  assert.deepEqual(parseMeter("{"), emptyMeter());
  const m = parseMeter(JSON.stringify({ calls: [call(0), { bad: 1 }], settings: { calls5h: 99 }, limit: { until: 5, at: 1, text: "x" } }));
  assert.equal(m.calls.length, 1);
  assert.equal(m.settings.calls5h, 99);
  assert.equal(m.limit?.until, 5);
});

test("stream-json result line carries turns, cost and cache tokens when present", () => {
  const r = parseStreamJsonLine(JSON.stringify({ type: "result", is_error: false, result: "ok", num_turns: 1, total_cost_usd: 0.012,
    usage: { input_tokens: 3, output_tokens: 7, cache_creation_input_tokens: 100, cache_read_input_tokens: 2000 } }));
  assert.deepEqual(r, { result: { text: "ok", isError: false, inputTokens: 3, outputTokens: 7, cacheWrite: 100, cacheRead: 2000, turns: 1, costUsd: 0.012 } });
});

test("isLimitAnswer: a short limit notice returned as the answer counts as a failure", () => {
  assert.equal(isLimitAnswer("Claude AI usage limit reached|1760800000"), true);
  assert.equal(isLimitAnswer("You've hit your limit · resets 3pm"), true);
  assert.equal(isLimitAnswer("Here is your plan for the week."), false);
  assert.equal(isLimitAnswer("x".repeat(400) + " hit your limit"), false); // long real answers are never mistaken for one
});
