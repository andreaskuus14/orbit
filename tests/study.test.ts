import { test } from "node:test";
import assert from "node:assert/strict";
import { NEW_PER_DAY, addCards, addDays, dueToday, lessonCard, newCard, parseDeck, parseDrafts, parseStore, quizCards, review, schedule, stats, studyable,
  type Card, type UserStudy } from "../src/lib/study-pure.ts";

const D = "2026-10-26";
let n = 0;
const id = () => `c${++n}`;
const card = (over: Partial<Card> = {}): Card => ({ ...newCard({ front: "Who designed Villa Savoye?", back: "Le Corbusier" }, "deck", D, id()), ...over });
const empty = (): UserStudy => ({ cards: [], log: [] });

test("addDays crosses months and DST without drifting", () => {
  assert.equal(addDays("2026-10-24", 3), "2026-10-27"); // EU DST ends 2026-10-25
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("SM-2: Good grows 1 → 3 → ×ease; Easy jumps ahead; Hard is short; Again resets and lowers ease", () => {
  let c = card();
  c = schedule(c, 3, D); assert.deepEqual([c.interval, c.due, c.reps], [1, "2026-10-27", 1]);
  c = schedule(c, 3, c.due); assert.equal(c.interval, 3);
  c = schedule(c, 3, c.due); assert.equal(c.interval, 8); // round(3 × 2.5)
  const easy = schedule(c, 4, c.due), hard = schedule(c, 2, c.due), good = schedule(c, 3, c.due);
  assert.ok(hard.interval < good.interval && good.interval < easy.interval, `${hard.interval} < ${good.interval} < ${easy.interval}`);
  assert.equal(easy.ease, 2.65); assert.equal(hard.ease, 2.35);
  const again = schedule(c, 1, c.due);
  assert.deepEqual([again.interval, again.due, again.reps, again.lapses, again.ease], [0, c.due, 0, 1, 2.3]);
  assert.equal(schedule(card(), 4, D).interval, 4, "Easy on a new card: 4 days");
  assert.equal(schedule(card(), 1, D).lapses, 0, "Again on a new card is not a lapse");
  let low = card({ ease: 1.35, interval: 5, reps: 3 });
  low = schedule(low, 1, D); assert.equal(low.ease, 1.3, "ease never drops below 1.3");
});

test("review logs maturity; dueToday puts due reviews first and caps new cards per day", () => {
  const u = empty();
  addCards(u, Array.from({ length: 15 }, (_, i) => ({ front: `Q${i}`, back: `A${i}` })), "deck", D, id);
  const old = card({ interval: 5, reps: 3, due: "2026-10-20" });
  u.cards.push(old, card({ interval: 5, reps: 3, due: "2026-10-30" }));
  let q = dueToday(u, D);
  assert.equal(q[0].id, old.id);
  assert.equal(q.length, 1 + NEW_PER_DAY);
  review(u, q[1].id, 3, D); review(u, q[2].id, 1, D); // one new learned, one failed (stays due today)
  assert.deepEqual(u.log.map((r) => r.mature), [false, false]);
  q = dueToday(u, D);
  assert.ok(q.some((c) => c.id === u.log[1].card), "an Again card is due again today");
  assert.equal(q.filter((c) => c.reps === 0 && !u.log.some((r) => r.card === c.id)).length, NEW_PER_DAY - 2, "new cards seen today count against the cap");
  review(u, old.id, 3, D);
  assert.equal(u.log.at(-1)!.mature, true);
  assert.equal(dueToday(u, addDays(D, 1)).filter((c) => !u.log.some((r) => r.card === c.id)).length, NEW_PER_DAY, "the cap resets the next day");
  assert.equal(review(u, "nope", 3, D), null);
});

test("stats: streak of consecutive days (today or from yesterday), recall over mature reviews in 30 days", () => {
  const u = empty();
  u.cards.push(card());
  const log = (day: string, grade: 1 | 2 | 3 | 4, mature = true) => u.log.push({ card: "x", day, grade, mature });
  log("2026-10-23", 3); log("2026-10-24", 1); log("2026-10-25", 3); log("2026-10-25", 4, false); log("2026-09-01", 1);
  let s = stats(u, D);
  assert.equal(s.streak, 3, "not reviewed yet today: the streak still counts from yesterday");
  assert.equal(s.retention, 0.67, "2 of 3 mature reviews in the window were not Again; the September one is outside it");
  assert.equal(s.reviewedToday, 0);
  log(D, 3); s = stats(u, D);
  assert.equal(s.streak, 4); assert.equal(s.reviewedToday, 1);
  assert.equal(stats(u, "2026-10-28").streak, 0, "a missed day breaks it");
  assert.equal(stats(empty(), D).retention, null);
});

test("addCards skips duplicates and empty sides; parseDeck reads common separators", () => {
  const u = empty();
  assert.equal(addCards(u, [{ front: "Q", back: "A" }, { front: " q ", back: "B" }, { front: "", back: "x" }], "deck", D, id).length, 1);
  assert.deepEqual(parseDeck("Pilotis :: columns lifting the box\nOpen plan | free plan\nbad line\nFenêtre en longueur - ribbon window\n\tx"), [
    { front: "Pilotis", back: "columns lifting the box" }, { front: "Open plan", back: "free plan" }, { front: "Fenêtre en longueur", back: "ribbon window" }]);
  assert.deepEqual(parseDeck("Q-with-dash :: answer"), [{ front: "Q-with-dash", back: "answer" }]);
});

test("sources: ARCH quiz, kept lesson, model drafts (bad JSON → nothing), journal never studyable", () => {
  assert.deepEqual(quizCards([{ q: "Who?", options: ["Le Corbusier", "Mies", "Wright", "Aalto"], answer: 0, why: "He designed it in 1928-31" }]),
    [{ front: "Who?", back: "Le Corbusier. He designed it in 1928-31" }]);
  assert.match(lessonCard({ text: "He usually approves short clips", planet: "studio" }).front, /STUDIO/);
  assert.deepEqual(parseDrafts('Sure! {"cards":[{"front":"What is a piloti?","back":"A column lifting a building"},{"front":"","back":"x"}]}'),
    [{ front: "What is a piloti?", back: "A column lifting a building" }]);
  assert.deepEqual(parseDrafts("no json"), []);
  assert.deepEqual(parseDrafts('{"cards": "nope"}'), []);
  assert.equal(studyable({ kind: "journal" }), false);
  assert.equal(studyable({ kind: "note", tags: ["journal"] }), false);
  assert.equal(studyable({ kind: "note", tags: ["arch"] }), true);
});

test("parseStore: empty file is a new store, garbage is null, bad rows are dropped", () => {
  assert.deepEqual(parseStore(""), { v: 1, users: {} });
  assert.equal(parseStore("{oops"), null);
  const good = card();
  const s = parseStore(JSON.stringify({ v: 1, users: { u1: { cards: [good, { id: "x", front: "", back: "y" }], log: [{ card: "x", day: D, grade: 3, mature: false }, { card: "x", day: D, grade: 9 }] } } }));
  assert.deepEqual(s?.users.u1.cards, [good]);
  assert.equal(s?.users.u1.log.length, 1);
});

test("parseDeck: '::' wins over a spaced dash in the question", () => {
  assert.deepEqual(parseDeck("Le Corbusier - Villa Savoye :: 1931"), [{ front: "Le Corbusier - Villa Savoye", back: "1931" }]);
});

test("MEM07: edits and source corrections keep history; schedule and review log stay", async () => {
  const { editCard, sourceCorrected, cardLog, review: rv, newCard: nc } = await import("../src/lib/study-pure.ts");
  const u = { cards: [nc({ front: "Q", back: "A" }, "memory", "2026-10-01", "c1", "m1"), nc({ front: "Q2", back: "B" }, "deck", "2026-10-01", "c2")], log: [] as never[] };
  rv(u, "c1", 3, "2026-10-01");
  const due = u.cards[0].due;
  assert.equal(sourceCorrected(u, "m1", "2026-10-05"), 1);
  assert.equal(u.cards[0].sourceChanged, "2026-10-05");
  assert.deepEqual(u.cards[0].history, [{ front: "Q", back: "A", day: "2026-10-05", why: "source" }]);
  assert.equal(u.cards[1].history, undefined);
  assert.ok(editCard(u, "c1", { front: "Q", back: "A fixed" }, "2026-10-06"));
  assert.equal(u.cards[0].back, "A fixed");
  assert.equal(u.cards[0].sourceChanged, undefined);
  assert.equal(u.cards[0].history?.length, 2);
  assert.equal(u.cards[0].due, due);
  assert.equal(cardLog(u, "c1").length, 1);
  assert.ok(!editCard(u, "c1", { front: "", back: "x" }, "2026-10-06"));
});
