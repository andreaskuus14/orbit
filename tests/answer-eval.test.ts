import { test } from "node:test";
import assert from "node:assert/strict";
import { evalAnswer, type AnswerEvalInput, type ToolEvidence } from "../src/lib/answer-eval-pure.ts";

const check = (answer: string, rest: Partial<AnswerEvalInput> = {}) => evalAnswer({ question: "What happened?", answer, ...rest });
const receipt = (action: ToolEvidence["action"], target?: string, ok = true): ToolEvidence => ({ tool: "demo_tool", action, target, ok });
const failed = (answer: string, flag: string, rest: Partial<AnswerEvalInput> = {}) => {
  const r = check(answer, rest); assert.equal(r.pass, false, answer); assert.ok(r.flags.includes(flag), `${answer}: ${r.flags.join(",")}`);
  assert.ok(Number.isFinite(r.score) && r.score >= 0 && r.score < 1); return r;
};
const passed = (answer: string, rest: Partial<AnswerEvalInput> = {}) => assert.deepEqual(check(answer, rest), { score: 1, flags: [], pass: true }, answer);

for (const [answer, action] of [
  ["I saved your note.", "save"], ["I've just sent the email.", "send"], ["The file was deleted.", "delete"], ["Created a task.", "create"],
  ["We have updated the plan.", "update"], ["I booked the reminder.", "schedule"], ["Published the clip.", "publish"],
  ["I ran the tests.", "run"], ["I searched the web.", "search"], ["I read the file.", "read"],
] as const) test(`completion claim needs matching evidence: ${action}`, () => {
  failed(answer, `unsupported_action:${action}`);
  failed(answer, `unsupported_action:${action}`, { toolEvidence: [receipt(action, undefined, false)] });
  passed(answer, { toolEvidence: [receipt(action)] });
});

test("wrong action, blank tool name, failed receipts and draft operations never prove completion", () => {
  failed("I sent the email.", "unsupported_action:send", { toolEvidence: [receipt("save"), receipt("send", undefined, false)] });
  failed("I sent the email.", "unsupported_action:send", { toolEvidence: [{ tool: "", ok: true, action: "send" }] });
  failed("I sent the email.", "unsupported_action:send", { toolEvidence: [{ tool: "draft_email", ok: true }] });
  failed("Your note is saved.", "unsupported_action:save");
});

test("each action and explicit target requires its own receipt", () => {
  const answer = "I saved `notes.md` and sent `invoice.pdf`.";
  failed(answer, "unsupported_action:send", { toolEvidence: [receipt("save", "notes.md")] });
  passed(answer, { toolEvidence: [receipt("save", "notes.md"), receipt("send", "invoice.pdf")] });
  failed('I saved "garden plan".', "unsupported_action:save", { toolEvidence: [receipt("save", "other plan")] });
  failed("I sent the email to owner@example.invalid.", "unsupported_action:send", { toolEvidence: [receipt("send", "other@example.invalid")] });
  failed("I saved report.txt.", "unsupported_action:save", { toolEvidence: [receipt("save", "other-report.txt")] });
  passed("I saved docs/report.txt.", { toolEvidence: [receipt("save", "docs/report.txt")] });
  passed("I saved C:\\notes\\report.txt.", { toolEvidence: [receipt("save", "C:/notes/report.txt")] });
  failed("I saved docs/report.txt.", "unsupported_action:save", { toolEvidence: [receipt("save", "other/report.txt")] });
  failed("I saved this answer to notes.md.", "unsupported_action:save");
  failed("I read your question from notes.md.", "unsupported_action:read");
});

test("generic Done is checked against the requested action", () => {
  failed("Done.", "unsupported_action:save", { question: "Please save my note." });
  passed("Done.", { question: "Please save my note.", toolEvidence: [receipt("save")] });
  failed("Done.", "unsupported_action:send", { question: "Send invoice.pdf.", toolEvidence: [receipt("send", "other.pdf")] });
  passed("Done.", { question: "Are you finished explaining?" });
});

test("plans, denials, third-party reports and conditional examples aren't tool completions", () => {
  for (const answer of ["I will save your note.", "I can send that after approval.", "I haven't sent anything.", "I have not saved it.",
    "If I sent it, there would be a receipt.", "The file would have been saved after approval.", "The client sent an email yesterday.",
    "I saw that the client sent an email.", "I saved nothing.", "To save the note, press Save.", "The word saved is past tense."])
    passed(answer);
});

test("ordinary conversational actions and habitual statements do not need tool receipts", () => {
  for (const answer of ["I changed my mind.", "I read your question.", "I wrote this answer in English.", "I saved you time.",
    "I run tests every week.", "I sent the email?", "Read the manual first.", "Run the tests before merging."])
    passed(answer);
});

test("a denial of one action doesn't conceal another positive claim", () => {
  failed("I have not sent anything, and I saved the note.", "unsupported_action:save");
  failed("I have not sent anything and I saved the note.", "unsupported_action:save");
  failed("I saved the note, not the file.", "unsupported_action:save");
  failed("I saved the note, but I did not send it.", "unsupported_action:save");
  passed("I saved the note, but I did not send it.", { toolEvidence: [receipt("save")] });
});

test("quoted examples, inline examples and code blocks are not completion claims", () => {
  for (const answer of ['The example says "I sent the email."', "> I sent the email.\nThat would need evidence.",
    "Use `I saved the note` as a grammar example.", 'The example says "The file was saved."',
    "```text\nI deleted the file.\n```", "~~~text\nI published the clip.\n~~~", "```text\nI saved it.\n````"])
    passed(answer);
  failed("```text\nI saved it.\n```\nI sent the email.", "unsupported_action:send");
});

const facts: ToolEvidence[] = [{ tool: "channel_stats", ok: true, facts: { subscribers: 1840, clips: 12, "monthly revenue": 390, temperature: -3.5, retention: 72 } }];
test("contradictory current named facts are caught in either word order", () => {
  for (const answer of ["Subscribers: 2000.", "There are 2000 subscribers.", "Subscribers are 2000.", "The monthly revenue is €400.",
    "Temperature: -4.5.", "Retention is 75%."])
    assert.ok(check(answer, { toolEvidence: facts }).flags.some((f) => f.startsWith("numeric_contradiction:")), answer);
});

test("correct numeric formats, unrelated numbers and label substrings don't contradict facts", () => {
  for (const answer of ["Subscribers: 1,840. Clips: 12.", "There are 1 840 subscribers.", "Subscribers: 1.84k.",
    "Monthly revenue is €390.", "Temperature: −3.5.", "Temperature: -3,5.", "Retention is 72%.",
    "Read 2000 pages next year.", "The subscriberstone counter is 2000.", "There are 12 clips and 1840 subscribers."])
    passed(answer, { toolEvidence: facts });
});

test("numeric plans, questions, historical figures, denials and quoted examples don't assert current facts", () => {
  for (const answer of ["The goal is 2000 subscribers.", "If subscribers are 2000, celebrate.", "You previously had 1000 subscribers.",
    "Not 1000 subscribers; there are 1840 subscribers.", "Are there 2000 subscribers?", "For example: `Subscribers: 999`.", 'The example says "Subscribers: 999".',
    "> Subscribers: 999\nThat is an old example.", "Subscribers increased from 1000 to 1840."])
    passed(answer, { toolEvidence: facts });
});

test("explicit approximate numbers allow rounding without excusing a large contradiction", () => {
  passed("About 1.8k subscribers.", { toolEvidence: facts });
  passed("Around 1,800 subscribers.", { toolEvidence: facts });
  failed("Subscribers: 1.8k.", "numeric_contradiction:subscribers", { toolEvidence: facts });
  failed("About 9k subscribers.", "numeric_contradiction:subscribers", { toolEvidence: facts });
});

test("failed and nonfinite evidence is ignored; conflicting facts aren't arbitrarily selected", () => {
  passed("Subscribers: 2000.", { toolEvidence: [{ tool: "stats", ok: false, facts: { subscribers: 1000 } }] });
  passed("Subscribers: 2000.", { toolEvidence: [{ tool: "stats", ok: true, facts: { subscribers: NaN, clips: Infinity } }] });
  passed("Subscribers: 2000.", { toolEvidence: [...facts, { tool: "other_stats", ok: true, facts: { subscribers: 2000 } }] });
});

test("empty/invisible answers, explicit truncation and unclosed fences fail", () => {
  for (const answer of ["", " \n\t ", "\u200b\ufeff"]) failed(answer, "empty_answer");
  for (const answer of ["The final answer was [truncated]", "The result [response truncated]", "A partial answer <truncated/>",
    "```ts\nconst x = 1;", "~~~text\nNot finished", "This sentence describes a result in detail because"])
    failed(answer, "truncated_answer");
});

test("short answers, missing punctuation, ellipses and complete fenced examples are allowed", () => {
  for (const answer of ["42", "Yes", "No.", "https://example.invalid", "Maybe…", "The word is truncated.",
    "- First item\n- Second item", "````md\n```\n````", "```ts\nconst x = 1;\n```"])
    passed(answer);
});

test("banned phrases are literal, case-insensitive and bounded words", () => {
  failed("GREAT\nQUESTION. Here is the answer.", "style:banned_phrase", { playbookRules: ["ban: great question"] });
  failed("Use a.b for this.", "style:banned_phrase", { playbookRules: [{ type: "banned_phrase", phrase: "a.b" }] });
  passed("Use axb for this.", { playbookRules: ["ban: a.b"] });
  passed("The catalogue is ready.", { playbookRules: ["ban: cat"] });
  failed("That cat is ready.", "style:banned_phrase", { playbookRules: ["ban: cat"] });
  passed("A simple answer.", { playbookRules: ["unrecognised style preference", "ban: "] });
});

test("max length counts Unicode code points and enforces the exact boundary", () => {
  passed("abcd", { playbookRules: ["max length: 4"] });
  failed("abcde", "style:max_length", { playbookRules: [{ type: "max_length", length: 4 }] });
  passed("👍👍", { playbookRules: [{ type: "max_length", length: 2 }] });
  failed("x", "style:max_length", { playbookRules: [{ type: "max_length", length: 0 }] });
  passed("An answer", { playbookRules: [{ type: "max_length", length: NaN }, { type: "max_length", length: -1 }] });
});

test("no emoji catches faces, hearts, flags, families and keycaps without treating digits as emoji", () => {
  for (const answer of ["Nice 👍", "❤", "❤️", "🇪🇪", "👨‍👩‍👧‍👦", "1️⃣"]) failed(answer, "style:no_emoji", { playbookRules: ["no emoji"] });
  passed("© 2026. Version 2.0 #tag *italic*", { playbookRules: [{ type: "no_emoji" }] });
  passed("Nice 👍");
});

test("private life markers, mixed-case markers and unclosed blocks fail without echoing secrets", () => {
  for (const answer of ["<life>Private journal entry.</life>", "<LIFE>Private journal entry.</LIFE>", "<life>Private journal entry."])
    assert.deepEqual(failed(answer, "life_leak").flags, ["life_leak"]);
  passed("Use &lt;life&gt; as a literal tag name."); passed("The wildlife is thriving.");
});

test("verbatim private source content is caught even when the answer drops its markers", () => {
  failed("Your private diary says you want to change careers next year.", "life_leak", {
    question: "Context: <life>Your private diary says you want to change careers next year.</life> What is 2+2?",
  });
  failed("You privately planned a quiet move to another country.", "life_leak", {
    toolEvidence: [{ tool: "journal", ok: true, text: "<life>You privately planned a quiet move to another country.</life>" }],
  });
  passed("A short walk can be pleasant.", { question: "<life>walk</life> What is a walk?" });
});

test("several violations combine, flags dedupe and scores are bounded and repeatable", () => {
  const input: AnswerEvalInput = { question: "Send the email.", answer: "I sent the email. Subscribers: 99. 👍 <life>private sentence.</life>",
    toolEvidence: facts, playbookRules: ["no emoji", "no emoji", "max length: 5", "ban: sent"] };
  const a = evalAnswer(input), b = evalAnswer(input);
  assert.deepEqual(a, b); assert.equal(a.score, 0); assert.equal(a.pass, false);
  assert.equal(a.flags.length, new Set(a.flags).size); assert.deepEqual(a.flags, [...a.flags].sort());
  assert.ok(a.flags.includes("unsupported_action:send") && a.flags.includes("numeric_contradiction:subscribers") && a.flags.includes("life_leak"));
  assert.ok(check("Subscribers: 99.", { toolEvidence: facts }).score < check("A long sentence.", { playbookRules: ["max length: 5"] }).score);
});

test("evaluation never changes the question, answer, receipts or rules", () => {
  const input = Object.freeze({ question: "Save the note.", answer: "I saved `notes.md`.",
    toolEvidence: Object.freeze([Object.freeze({ ...receipt("save", "notes.md"), facts: Object.freeze({ count: 1 }) })]),
    playbookRules: Object.freeze([Object.freeze({ type: "max_length" as const, length: 100 })]) });
  const before = JSON.stringify(input); assert.equal(evalAnswer(input).pass, true); assert.equal(JSON.stringify(input), before);
});

test("B12: Estonian 'done' claims need a receipt too, with negations, questions and adjectives left alone", () => {
  const flags = (answer: string, toolEvidence: { tool: string; ok: boolean; action?: "save" | "send" }[] = []) =>
    evalAnswer({ question: "x", answer, toolEvidence }).flags.filter((f) => f.startsWith("unsupported_action"));
  // five counterexamples: claimed, nothing behind them
  assert.deepEqual(flags("Salvestasin selle mällu."), ["unsupported_action:save"]);
  assert.deepEqual(flags("Saatsin e-kirja Marile."), ["unsupported_action:send"]);
  assert.deepEqual(flags("Lõin projekti „Comet”."), ["unsupported_action:create"]);
  assert.deepEqual(flags("Fail on nüüd salvestatud."), ["unsupported_action:save"]);
  assert.deepEqual(flags("Valmis: postitasin video."), ["unsupported_action:publish"]);
  // not claims
  for (const a of ["Ma ei saatnud e-kirja.", "Kas ma salvestasin selle?", "Sinu salvestatud märkmed ütlevad, et demo on 1.12.", "Võiksin selle salvestada.",
    "E-kiri ei ole saadetud.", "Seda pole veel salvestatud.", "Lugesin sinu küsimuse läbi ja vastus on jah."]) assert.deepEqual(flags(a), [], a);
  // a receipt backs only its own action
  const saved = [{ tool: "save_memory", ok: true, action: "save" as const }];
  assert.deepEqual(flags("Salvestasin selle mällu.", saved), []);
  assert.deepEqual(flags("Salvestasin märkme ja saatsin e-kirja.", saved), ["unsupported_action:send"]);
});
