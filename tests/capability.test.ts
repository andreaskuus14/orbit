import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPS, blockedReason, startCheck, withHeadsUp, cantDo, capRow, coreNote, evaluate, guessLang, missingFor, routedModules, type Facts } from "../src/lib/capability-pure.ts";

const ALL_ENV = { YOUTUBE_API_KEY: "k", YOUTUBE_OAUTH_CLIENT_ID: "i", YOUTUBE_OAUTH_CLIENT_SECRET: "s", RESEND_API_KEY: "r", ORBIT_MAIL_FROM: "a@b", ORBIT_LOCAL_MODEL: "qwen" };
const full: Facts = { checks: { claude: "ok", ytkey: "ok", ffmpeg: "ok", whisper: "warn" }, env: ALL_ENV, ytConnected: true, ytExpired: false, calendar: true, pushProblem: null, phones: 1 };
const bare: Facts = { checks: {}, env: {}, ytConnected: false, ytExpired: false, calendar: false, pushProblem: "no keys", phones: 0 };

test("everything set up: nothing missing", () => {
  assert.deepEqual(cantDo(evaluate(full)), []);
});

test("nothing set up: config deps missing, doctor-only deps unknown (never block)", () => {
  const s = evaluate(bare);
  assert.equal(s.claude, null); assert.equal(s.ffmpeg, null); assert.equal(s.higgsfield, null);
  assert.deepEqual(cantDo(s).map((m) => m.id), ["youtube_stats", "youtube_upload", "email_send", "calendar", "local_brain", "phone"]);
});

test("doctor failures make deps missing; warn does not", () => {
  const s = evaluate({ ...full, checks: { claude: "fail", ytkey: "fail", ffmpeg: "fail", whisper: "warn" } });
  assert.equal(s.claude, false); assert.equal(s.higgsfield, false); assert.equal(s.youtube_key, false); assert.equal(s.ffmpeg, false); assert.equal(s.whisper, true);
  assert.equal(evaluate({ ...full, checks: { ...full.checks, ytkey: "warn" } }).youtube_key, true); // quota used up is not "missing"
  assert.equal(evaluate({ ...full, checks: { claude: "fail" }, env: { ...ALL_ENV, ORBIT_HIGGSFIELD_DRY_RUN: "1" } }).higgsfield, true);
});

test("expired YouTube sign-in and missing client settings both mean not connected", () => {
  assert.equal(evaluate({ ...full, ytExpired: true }).youtube_oauth, false);
  assert.equal(evaluate({ ...full, env: { ...ALL_ENV, YOUTUBE_OAUTH_CLIENT_SECRET: " " } }).youtube_oauth, false);
});

test("ARCH needs nothing", () => {
  assert.deepEqual(CAPS.find((c) => c.id === "arch")!.deps, []);
});

test("request intent → only the missing things it asks for (EN and ET alike)", () => {
  const s = evaluate(bare);
  const ids = (t: string) => missingFor(t, s).map((m) => m.id);
  assert.deepEqual(ids("send the email to the client"), ["email_send"]);
  assert.deepEqual(ids("saada kliendile e-kiri"), ["email_send"]);
  assert.deepEqual(ids("upload the short to YouTube"), ["youtube_upload"]);
  assert.deepEqual(ids("lae video YouTube'i üles"), ["youtube_upload"]);
  assert.deepEqual(ids("what's on my calendar tomorrow"), ["calendar"]);
  assert.deepEqual(ids("mis mul homme kalendris on"), ["calendar"]);
  assert.deepEqual(ids("research the best laptops"), []);
  assert.deepEqual(ids("draft an email to Mark"), []); // drafting needs nothing
});

test("CORE: routed modules add their missing capabilities", () => {
  const s = evaluate(bare);
  assert.ok(routedModules("check my youtube channel").includes("STUDIO"));
  assert.deepEqual(missingFor("check my youtube channel", s, ["STUDIO"]).map((m) => m.id), ["youtube_stats", "youtube_upload"]);
  assert.equal(missingFor("hello", evaluate(full), ["STUDIO", "BUSINESS"]).length, 0);
});

test("texts: blocked reason and CORE note name the thing and the fix; empty when nothing missing", () => {
  const m = missingFor("send the email", evaluate(bare));
  assert.match(blockedReason(m, "en"), /^Not started: .*Sending email.*RESEND_API_KEY/);
  assert.match(blockedReason(m, "et"), /^Ei alustatud: .*E-kirjade saatmine.*RESEND_API_KEY/);
  assert.match(coreNote(m), /CAPABILITIES RIGHT NOW.*Sending email.*BEFORE promising/);
  assert.equal(blockedReason([], "en"), ""); assert.equal(coreNote([]), "");
  const clips = capRow({ id: "clips", deps: ["ffmpeg", "whisper"] }, "en");
  assert.match(clips.why, /ffmpeg.*; .*speech-to-text/);
});

test("guessLang", () => {
  assert.equal(guessLang("tee mulle ülevaade"), "et");
  assert.equal(guessLang("make me a summary"), "en");
});

test("start: keyword-guessed needs never block; they become a heads-up on the task", () => {
  const s = evaluate({ ...full, env: { ...ALL_ENV, RESEND_API_KEY: "" } });
  const r = startCheck(missingFor("research X and send me an email", s), "en");
  assert.equal(r.block, "");
  assert.match(r.headsUp, /^Heads-up: email sending isn't set up, so the step that needs it will stop for you\. Fix: Add RESEND_API_KEY/);
  assert.match(startCheck(missingFor("saada kliendile e-kiri", s), "et").headsUp, /^Teadmiseks: e-kirjade saatmine pole seadistatud.*RESEND_API_KEY/);
  const t = withHeadsUp("Research X", "research X and send me an email", r.headsUp);
  assert.ok(t.title.startsWith("⚠ ")); assert.ok(t.request.endsWith(r.headsUp));
  assert.deepEqual(withHeadsUp("a", "b", ""), { title: "a", request: "b" });
  assert.deepEqual(startCheck(missingFor("research X", evaluate(full)), "en"), { block: "", headsUp: "" });
});

test("start: only a known-down Claude Code refuses up front (unknown never does)", () => {
  const down = evaluate({ ...full, checks: { claude: "fail" }, env: { ...ALL_ENV, RESEND_API_KEY: "" } });
  const r = startCheck(missingFor("research X and send me an email", down), "en");
  assert.match(r.block, /^Not started: .*Claude Code/);
  assert.match(r.headsUp, /email sending/);
  assert.equal(startCheck(missingFor("research X", evaluate({ ...full, checks: {} })), "en").block, "");
});
