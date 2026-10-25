import { test } from "node:test";
import assert from "node:assert/strict";
import { CORRECTION_TTL, MINED_EVENTS, activeBand, addCorrection, clipLabel, correctionLesson, decide, keptText, lessonBoost, lessonsPrompt, mine, nicheTraits,
  opensWithNumber, parseStore, reconcile, withPrior, type Signal, type Stored } from "../src/lib/lessons-pure.ts";

const NOW = Date.parse("2026-10-25T03:30:00Z");
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
let n = 0;
const sig = (area: string, key: string, label: string, ok: boolean | undefined, days = 2): Signal => ({ id: `event:${++n}`, at: ago(days), area, key, label, ...(ok === undefined ? {} : { ok }) });
const many = (k: number, f: (i: number) => Signal) => Array.from({ length: k }, (_, i) => f(i));

// Synthetic owner: rejects long clips ("too long"), approves question hooks, ignores echo's proposals, opens STUDIO first in the morning,
// gets replies from outreach drafts that open with a number, chats in the evening.
const SYNTH: Signal[] = [
  ...many(6, (i) => sig("clip.length", "40+", clipLabel("length", "40+"), false, i)),
  ...many(6, (i) => sig("clip.length", "20-30", clipLabel("length", "20-30"), i !== 0, i)),
  ...many(5, (i) => sig("clip.hookStyle", "question", clipLabel("hookStyle", "question"), true, i)),
  ...many(7, (i) => sig("clip.hookStyle", "statement", clipLabel("hookStyle", "statement"), i % 2 === 0, i)),
  ...many(5, (i) => sig("clip.reason", "too long", "too long", undefined, i)),
  sig("clip.reason", "boring", "boring", undefined),
  ...many(5, (i) => sig("proposal.agent", "echo", "echo", false, i)),
  ...many(5, (i) => sig("proposal.agent", "atlas", "atlas", i !== 4, i)),
  ...many(6, (i) => sig("morning.source", "studio", "STUDIO", undefined, i)),
  ...many(2, (i) => sig("morning.source", "news", "NEWS", undefined, i)),
  ...many(6, (i) => sig("outreach.open", "number", "open with a concrete number", i !== 3, i)),
  ...many(5, (i) => sig("outreach.open", "plain", "open without a number", i === 0, i)),
  ...many(12, (i) => sig("active", "evening", activeBand(20).label, undefined, i)),
  ...many(3, (i) => sig("active", "morning", activeBand(9).label, undefined, i)),
];

test("synthetic decisions become human-style lessons with evidence", () => {
  const ls = mine(SYNTH, NOW), by = (id: string) => ls.find((l) => l.id === id);
  assert.match(by("clip.length|40+|-")!.text, /^He usually rejects clips over 40 s; avoid them/);
  assert.match(by("clip.hookStyle|question|+")!.text, /approves clips with a question hook/);
  assert.match(by("clip.reason|too long|+")!.text, /usually “too long”: cut tighter, prefer cold opens/);
  assert.match(by("proposal.agent|echo|-")!.text, /dismisses or ignores proposals from echo/);
  assert.match(by("morning.source|studio|+")!.text, /acts on STUDIO first/);
  assert.match(by("outreach.open|number|+")!.text, /open with a concrete number get more replies/);
  assert.match(by("active|evening|+")!.text, /active in the evening/);
  assert.equal(by("clip.hookStyle|statement|+"), undefined, "a 50/50 pattern is no lesson");
  assert.equal(by("clip.reason|boring|+"), undefined, "one rejection is not a pattern");
  assert.ok(by("clip.length|40+|-")!.evidence.every((e) => e.startsWith("event:")) && by("clip.length|40+|-")!.evidence.length === 6);
  assert.deepEqual(by("morning.source|studio|+")!.tags, ["studio", "clips"]);
});

test("min support, recency decay and old data", () => {
  assert.deepEqual(mine(many(3, () => sig("proposal.agent", "echo", "echo", false)), NOW), [], "3 < MIN_SUPPORT");
  assert.deepEqual(mine(many(6, () => sig("proposal.agent", "echo", "echo", false, 200)), NOW), [], "older than MAX_AGE");
  assert.deepEqual(mine(many(5, () => sig("proposal.agent", "echo", "echo", false, 150)), NOW), [], "decayed weight too small");
  assert.equal(mine(many(5, () => sig("proposal.agent", "echo", "echo", false, 10)), NOW).length, 1);
});

test("LIFE and journal events are never mined", () => {
  for (const t of ["life.habit", "focus.session", "journal.saved", "memory.saved"]) assert.ok(!(MINED_EVENTS as readonly string[]).includes(t));
  assert.deepEqual(mine([...many(8, () => sig("life", "gym", "gym", true))], NOW), [], "unknown areas are ignored");
});

test("reconcile: rejected never return, kept stay and refresh, faded proposals go", () => {
  const fresh = mine(SYNTH, NOW);
  let st = reconcile([], fresh, NOW);
  assert.ok(st.every((l) => l.status === "proposed"));
  const echo = "proposal.agent|echo|-", studio = "morning.source|studio|+";
  st = decide(st, echo, "reject", NOW) as Stored[];
  st = decide(st, studio, "keep", NOW) as Stored[];
  assert.equal(typeof decide(st, studio, "keep", NOW), "string", "can't keep twice");
  const again = reconcile(st, fresh, NOW + 86_400_000);
  assert.equal(again.find((l) => l.id === echo)!.status, "rejected");
  assert.equal(again.filter((l) => l.id === echo).length, 1);
  // Pattern gone: the kept lesson stays (additions only), proposals disappear.
  const later = reconcile(again, [], NOW + 2 * 86_400_000);
  assert.deepEqual(later.map((l) => l.status).sort(), ["kept", "rejected"]);
});

test("correction capture", () => {
  const prev = "Here are 5 bullet points about your channel.";
  assert.equal(correctionLesson("no, I meant the Roblox game", prev, "m1", NOW)!.text, "When he corrected me he meant “the Roblox game”; check what he means before assuming");
  assert.equal(correctionLesson("Don't use bullet points for this kind of thing.", prev, "m2", NOW)!.text, "Don't use bullet points for this kind of thing");
  assert.equal(correctionLesson("don't do that again", prev, "m3", NOW)!.text, "He told me not to repeat this: “Here are 5 bullet points about your channel”");
  assert.equal(correctionLesson("No, that's the wrong channel", prev, "m4", NOW)!.text, "He corrected me: “that's the wrong channel”");
  assert.equal(correctionLesson("no thanks", prev, "m5", NOW), null);
  assert.equal(correctionLesson("What about tomorrow?", prev, "m6", NOW), null);
  assert.equal(correctionLesson("no, I meant my password is hunter2", prev, "m7", NOW), null, "never a secret");
  assert.equal(correctionLesson("no, I meant the other one", "", "m8", NOW), null, "needs a CORE reply to correct");
  const l = correctionLesson("Don't use bullet points", prev, "m9", NOW)!;
  assert.deepEqual(l.evidence, ["message:m9"]);
  const a = addCorrection([], l);
  assert.ok(a.added);
  assert.equal(addCorrection(a.lessons, l).added, null, "no duplicate");
  const rej = decide(a.lessons, l.id, "reject", NOW) as Stored[];
  assert.equal(addCorrection(rej, { ...l, id: "correction|other" }).added, null, "same text rejected before: never again");
  assert.equal(reconcile(a.lessons, [], NOW + CORRECTION_TTL + 1).length, 0, "untapped correction expires");
  assert.equal(reconcile(a.lessons, [], NOW + 86_400_000).length, 1);
});

const keep = (ls: ReturnType<typeof mine>) => ls.map((l): Stored => ({ ...l, status: "kept", decidedAt: ago(1) }));

test("CORE prompt: relevant kept lessons only, small budget, no proposals", () => {
  const kept = keep(mine(SYNTH, NOW));
  const studio = lessonsPrompt(kept, "pick clips from yesterday's stream");
  assert.match(studio, /clips over 40 s/);
  assert.match(studio, /active in the evening/, "core lessons always apply");
  assert.doesNotMatch(studio, /proposals from echo/);
  assert.ok(studio.length < 1200);
  assert.doesNotMatch(lessonsPrompt(kept, "what's the weather"), /clips/);
  assert.equal(lessonsPrompt(kept.map((l) => ({ ...l, status: "proposed" as const })), "clips"), "");
});

test("priors: small, signed, bounded", () => {
  const kept = keep(mine(SYNTH, NOW));
  const b = lessonBoost(kept, ["studio"]);
  assert.ok(b > 1 && b < 1.15);
  assert.ok(lessonBoost(kept, ["agents"]) < 1, "echo dismissals push agents down");
  assert.equal(lessonBoost(kept, ["markets"]), 1);
  assert.equal(lessonBoost(kept, ["clips"]), b, "night-shift kind shares the morning source lesson");
  const [s, x] = withPrior([{ kind: "task", source: "studio", base: 0.7 }, { kind: "news", source: "news", base: 0.7 }], kept);
  assert.ok(s.base > x.base && s.base <= 1);
  assert.match(keptText(kept, "studio"), /too long/);
});

test("helpers", () => {
  assert.equal(opensWithNumber("Hi Mari,\n3 of your enquiries waited over a day last week."), true);
  assert.equal(opensWithNumber("Hello! I help salons answer faster. We saved 40 hours."), false);
  assert.deepEqual(nicheTraits({ demandScore: 5, competitionScore: 1 }).map((t) => t.label), ["low-competition", "high-demand"]);
  assert.equal(activeBand(23).key, "evening");
  assert.equal(clipLabel("length", "<20"), "clips under 20 s");
  assert.deepEqual(parseStore(""), { v: 1, users: {} });
  assert.equal(parseStore("{broken"), null, "a broken file is never treated as empty");
});
