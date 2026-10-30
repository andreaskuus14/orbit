import { test } from "node:test";
import assert from "node:assert/strict";
import { cardProblems, goalHint, goalMission, isVague, mayAsk, parseChoices, parseGoalCard, withoutCard, EXACT } from "../src/lib/goal-card-pure.ts";

test("isVague: ideas yes (EN+ET), concrete asks and questions no", () => {
  for (const q of ["make my bakery site better", "I want more players in Pet Simulator", "help me get clients for the cleaning business", "teen bakery site but nicer", "tee mu pagariäri leht ilusamaks", "tahan rohkem mängijaid"]) assert.ok(isVague(q), q);
  for (const q of ["Build index.html with a 3-item menu", "What makes a site better?", "Kas see on parem?", "Remember: launch is Monday", "make the hero 2x bigger by Friday"]) assert.ok(!isVague(q), q);
});

test("mayAsk only for spend/send/publish/delete", () => {
  assert.ok(mayAsk("help me get clients, email them"));
  assert.ok(mayAsk("saada neile meile"));
  assert.ok(!mayAsk("make my bakery site better"));
});

const card = { objective: "Make the bakery site convert more visitors into orders.", why: "Bakery is a client project (memory)", deliverables: ["New hero + menu section"],
  acceptance: ["Page loads with no console errors", "Menu lists at least 6 items with prices"], assumptions: ["Keep current colours"], effort: "about 1 hour, no spend",
  steps: ["Read current site", "Draft new hero", "Write files and check"], agent: "Nova", fromMemory: ["Bakery is called Hearth & Rye"] };
const reply = `Here's the goal I'd go for.\n\n\`\`\`goal\n${JSON.stringify(card)}\n\`\`\`\nChoices: Start small | Full redesign | Both`;

test("parse, strip, validate a good card", () => {
  const c = parseGoalCard(reply)!;
  assert.equal(c.agent, "Nova");
  assert.deepEqual(cardProblems(c, "make my bakery site better"), []);
  assert.ok(!withoutCard(reply).includes("```goal"));
  assert.deepEqual(parseChoices(reply), ["Start small", "Full redesign", "Both"]);
  assert.equal(parseGoalCard("no card"), null);
  assert.equal(parseGoalCard("```goal\n{bad\n```"), null);
});

test("card problems: unchecked acceptance, gated question, exact wording, step count", () => {
  const p = cardProblems({ ...card, acceptance: ["looks better"], question: "Which colour?", steps: ["a"], assumptions: ["Send this exact line to start"] }, "make my bakery site better");
  assert.ok(p.some((x) => x.startsWith("acceptance not checkable")));
  assert.ok(p.includes("asked a question where a default would do"));
  assert.ok(p.includes("needs exactly 3 first steps"));
  assert.ok(p.includes("tells the owner to send exact wording"));
  assert.deepEqual(cardProblems({ ...card, question: "What monthly ad budget?" }, "get clients, maybe ads"), []);
});

test("Start → mission body keeps external effects behind approval", () => {
  const m = goalMission(card, "en");
  assert.equal(m.steps.length, 3);
  assert.equal(m.steps[0].agent, "nova");
  assert.match(m.acceptance, /6 items/);
  assert.match(m.constraints[0], /Don't send, spend, post or publish/);
});

test("goalHint: card for ideas, revise after a card, rules always; no exact-line asks anywhere", () => {
  assert.match(goalHint("make my bakery site better"), /```goal/);
  assert.match(goalHint("make my bakery site better"), /Don't ask any question/);
  assert.match(goalHint("help me get clients, email them"), /ONE short question/);
  assert.match(goalHint("blue not green", reply), /revise that card/);
  assert.doesNotMatch(goalHint("What time is it?"), /```goal/);
  assert.ok(EXACT.test("send these exact lines as separate messages"));
});
