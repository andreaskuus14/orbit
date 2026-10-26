import { test } from "node:test";
import assert from "node:assert/strict";
import {
  challengeLine, checkReply, CHALLENGE_MS, findShortcut, makeChallenge, newShortcutToken, parseReply, shortcutHash, speakable, statusLine, watchApprovable, type Shortcut,
} from "../src/lib/remote-shortcut-pure.ts";
import { echoProblem, type Approval } from "../src/lib/remote-web-pure.ts";

const SECRET = "s".repeat(32);
const token = newShortcutToken(new Uint8Array(32).fill(7));
const sc = (over: Partial<Shortcut> = {}): Shortcut => ({ id: "a", name: "Status", action: "status", userId: "u", hash: shortcutHash(token, SECRET), createdAt: "2026-10-26T00:00:00Z", ...over });
const spend: Approval = { id: "123e4567-e89b-42d3-a456-426614174000", key: "spend:x", kind: "spend", title: "Squid", detail: "", seen: "t|f", credits: 120 };
const clip: Approval = { id: "223e4567-e89b-42d3-a456-426614174000", key: "clip:j/c", kind: "clip", title: "Giant Squid", detail: "", seen: "abc", thumb: true };

test("tokens: only the exact bearer token of a listed shortcut matches; a changed REMOTE_SECRET revokes all", () => {
  assert.match(token, /^orbit_sc_[A-Za-z0-9_-]{43}$/);
  assert.throws(() => newShortcutToken(new Uint8Array(16)));
  assert.equal(findShortcut([sc()], `Bearer ${token}`, SECRET)?.id, "a");
  assert.equal(findShortcut([sc()], token, SECRET), null); // no scheme
  assert.equal(findShortcut([sc()], `Bearer ${token}x`, SECRET), null);
  assert.equal(findShortcut([sc()], null, SECRET), null);
  assert.equal(findShortcut([sc()], `Bearer ${token}`, "t".repeat(32)), null);
  assert.equal(findShortcut([], `Bearer ${token}`, SECRET), null); // revoked
});

test("statusLine: counts and kinds only, never titles", () => {
  assert.equal(statusLine({ stopOn: false, kinds: [], running: 0 }), "ORBIT is running. Nothing waiting for you.");
  assert.equal(statusLine({ stopOn: true, kinds: ["clip", "clip", "spend"], running: 1 }), "Stop-all is ON. 3 waiting for you: 2 clips, 1 spend. 1 job running.");
  assert.equal(statusLine({ stopOn: false, kinds: ["nego"], running: 0 }), "ORBIT is running. 1 waiting for you: 1 negotiation."); // not "1 waiting for you: ."
});

test("watchApprovable: spends and previewable clips; never email sends", () => {
  assert.ok(watchApprovable(spend) && watchApprovable(clip));
  assert.ok(!watchApprovable({ ...clip, thumb: false }));
  assert.ok(!watchApprovable({ ...clip, kind: "send", to: "a@b.c" }));
});

test("parseReply: the first four digits are the code, the rest the credits", () => {
  assert.deepEqual(parseReply("4821"), { code: "4821" });
  assert.deepEqual(parseReply("4 8 2 1 1 2 0"), { code: "4821", credits: 120 });
  assert.deepEqual(parseReply("4821, 1,200 credits"), { code: "4821", credits: 1200 });
  assert.deepEqual(parseReply("0042 5"), { code: "0042", credits: 5 });
  assert.equal(parseReply("482"), null);
  assert.equal(parseReply("yes"), null);
  assert.equal(parseReply(4821), null);
});

test("challenge: right code → the echo decideApproval checks; spends need the exact credits", () => {
  const now = 1_000;
  const ch = makeChallenge("a", spend, () => 42, now);
  assert.equal(ch.code, "0042");
  assert.match(challengeLine(spend, ch.code), /120 credits.*say 0 0 4 2 and then 120/);
  // no credits: refused, challenge kept
  const noCredits = checkReply(ch, "0042", now);
  assert.ok(!noCredits.ok && noCredits.next === ch);
  // wrong credits pass the code check but echoProblem (inside decideApproval) refuses them
  const wrong = checkReply(ch, "0042 100", now);
  assert.ok(wrong.ok);
  assert.match(echoProblem(spend, wrong.echo, "approve"), /quote is now 120/);
  const right = checkReply(ch, "0 0 4 2 120", now);
  assert.ok(right.ok && right.id === spend.id);
  assert.equal(echoProblem(spend, right.echo, "approve"), "");
  // item changed since the prompt (new quote): decideApproval refuses
  assert.match(echoProblem({ ...spend, seen: "t2|f" }, right.echo, "approve"), /changed/);
});

test("challenge: clips need no credits; wrong codes die after three; expired or missing is refused", () => {
  const now = 1_000;
  const ch = makeChallenge("a", clip, () => 1234, now);
  const ok = checkReply(ch, "1234", now);
  assert.ok(ok.ok);
  assert.equal(echoProblem(clip, ok.echo, "approve"), "");
  let c = checkReply(ch, "9999", now);
  assert.ok(!c.ok && c.next?.tries === 1);
  c = checkReply(!c.ok ? c.next : null, "9999", now);
  c = checkReply(!c.ok ? c.next : null, "nope", now);
  assert.ok(!c.ok && c.next === null && /three/.test(c.error));
  assert.ok(!checkReply(ch, "1234", now + CHALLENGE_MS).ok);
  assert.ok(!checkReply(null, "1234", now).ok);
});

test("speakable: no markdown or links, cut at a sentence", () => {
  assert.equal(speakable("**Hi** [there](https://x.y). See https://a.b"), "Hi there. See");
  assert.equal(speakable(""), "CORE had no answer.");
  const long = "One sentence here. ".repeat(40);
  const s = speakable(long, 100);
  assert.ok(s.length <= 100 && s.endsWith("."));
});
