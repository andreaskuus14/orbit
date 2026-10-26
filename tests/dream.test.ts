import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDream, detect, dreamContextText, dreamNotes, dueDay, markAsked, rankDream, you, type DreamIn, type DNote } from "../src/lib/dream-pure.ts";

const DAY = 86_400_000;
const now = Date.parse("2026-10-28T06:00:00Z"); // Wednesday morning in Tallinn
const ago = (d: number) => new Date(now - d * DAY).toISOString();
const note = (id: string, d: number, content: string, kind = "note", tags: string[] = []): DNote => ({ id, kind, title: content.slice(0, 30), content, created_at: ago(d), tags });
const base = (over: Partial<DreamIn> = {}): DreamIn => ({ now, tz: "Europe/Tallinn", facts: [], notes: [], goals: [], dev: [], asked: {}, ...over });

test("dueDay resolves weekdays, relative words and dates against the day it was said", () => {
  assert.deepEqual(dueDay("The pet sim update ships Friday.", "2026-10-26"), { day: "2026-10-30", word: "Friday" }); // said Monday
  assert.deepEqual(dueDay("done by next Friday", "2026-10-26"), { day: "2026-11-06", word: "Friday" });
  assert.equal(dueDay("finish it tomorrow", "2026-10-26")?.day, "2026-10-27");
  assert.equal(dueDay("launch on Nov 3", "2026-10-26")?.day, "2026-11-03");
  assert.equal(dueDay("release 2026-11-01", "2026-10-26")?.day, "2026-11-01");
  assert.equal(dueDay("I like pizza", "2026-10-26"), null);
});

test("a deadline that went quiet becomes the top question (the pet sim example)", () => {
  const [c] = rankDream(base({ notes: [note("n1", 2, "The pet sim update ships Friday.", "decision")], dev: [ago(2.3)] })); // said Monday 09:00, last session Monday 01:48 (Tallinn)
  assert.equal(c.kind, "deadline");
  assert.match(c.question, /^You said the pet sim update ships Friday, but there's been no dev session since Monday\. Still Friday\?$/);
});

test("a deadline with recent work on the topic is not asked", () => {
  const x = base({ notes: [note("n1", 3, "The pet sim update ships Friday.")], dev: [ago(0.5)] });
  assert.equal(detect(x).filter((c) => c.kind === "deadline").length, 0);
});

test("a belief contradicted by a newer note", () => {
  const x = base({ facts: [{ id: "f1", statement: "I use Blender for my game models", created_at: ago(40) }],
    notes: [note("n2", 1, "Switched from Blender to Roblox Studio for game models, not using Blender anymore.")] });
  const c = rankDream(x)[0];
  assert.equal(c.kind, "contradiction");
  assert.match(c.question, /^You told me you use Blender for your game models, but yesterday you said .+\. Which is true now\?$/);
});

test("open loops: an intention with nothing since; closed when a later note covers it", () => {
  const open = base({ notes: [note("n3", 6, "I'll write the egg hatching tutorial script.")] });
  const c = rankDream(open)[0];
  assert.equal(c.kind, "loop");
  assert.match(c.question, /you said you'd write the egg hatching tutorial script\. Did that happen, or should I drop it\?$/);
  const closed = base({ notes: [...open.notes, note("n4", 2, "Egg hatching tutorial script recorded.")] });
  assert.equal(detect(closed).filter((x) => x.kind === "loop").length, 0);
});

test("stale time-bound beliefs, and patterns that keep coming back", () => {
  const x = base({ facts: [{ id: "f2", statement: "I'm currently learning Blender sculpting", created_at: ago(120) }] });
  assert.match(rankDream(x)[0].question, /^Back in \w+ you told me you're currently learning Blender sculpting\. Is that still true\?$/);
  const p = base({ notes: [note("a", 1, "Thumbnail tests again"), note("b", 3, "thumbnail ideas"), note("c", 5, "thumbnail colors")] });
  assert.deepEqual(rankDream(p).map((c) => [c.kind, c.question]), [["pattern", "Thumbnail came up on 3 different days lately. Want to make it a goal?"]]);
  assert.equal(rankDream({ ...p, goals: [{ id: "g", title: "Better thumbnails thumbnail", updated_at: ago(1) }] }).length, 0);
});

test("ranking: deadlines beat contradictions beat loops; asked keys wait 14 days", () => {
  const x = base({
    facts: [{ id: "f1", statement: "I use Blender for my game models", created_at: ago(40) }],
    notes: [note("n1", 2, "The pet sim update ships Friday."), note("n2", 1, "Not using Blender for game models anymore."), note("n3", 6, "I'll write the egg hatching tutorial script.")],
  });
  const r = rankDream(x);
  assert.deepEqual(r.map((c) => c.kind), ["deadline", "contradiction", "loop"]);
  assert.equal(rankDream({ ...x, asked: { [r[0].key]: "2026-10-20" } })[0].kind, "contradiction");
  assert.equal(rankDream({ ...x, asked: { [r[0].key]: "2026-10-01" } })[0].kind, "deadline");
  assert.deepEqual(markAsked({ old: "2026-07-01", recent: "2026-10-20" }, "k", "2026-10-28"), { recent: "2026-10-20", k: "2026-10-28" });
});

test("journal and LIFE notes never take part", () => {
  const j = [note("j1", 6, "I'll call grandma about the trip.", "journal"), note("j2", 6, "I'll start running every morning.", "note", ["life"])];
  assert.deepEqual(dreamNotes(j), []);
  assert.deepEqual(detect(base({ notes: j })), []);
});

test("you() turns his words around", () => {
  assert.equal(you("I'll finish my shop UI."), "you'd finish your shop UI");
  assert.equal(you("ORBIT voice is slow"), "ORBIT voice is slow");
});

test("cleanDream keeps a good model pick and rejects anything off", () => {
  const cands = rankDream(base({ notes: [note("n1", 2, "The pet sim update ships Friday.")], dev: [ago(2.3)] }));
  const good = cleanDream('{"pick": 1, "question": "Quick check: is the pet sim update still shipping Friday?"}', cands);
  assert.equal(good?.question, "Quick check: is the pet sim update still shipping Friday?");
  for (const bad of ["not json", '{"pick": 4, "question": "Is the pet sim update still on?"}', '{"pick": 1, "question": "Is the pet sim update still on? Really?"}',
    '{"pick": 1, "question": "Will the pet sim update ship with 50 new pets?"}', '{"pick": 1, "question": "How did you sleep last night, friend?"}', '{"pick": 1, "question": "**Pet sim** update still Friday?"}'])
    assert.equal(cleanDream(bad, cands), null, bad);
});

test("CORE sees the question only on the day it was asked", () => {
  const d = { day: "2026-10-28", key: "k", kind: "loop" as const, question: "Still Friday?", by: "rules" as const };
  assert.match(dreamContextText(d, "2026-10-28"), /This morning ORBIT asked him: "Still Friday\?"/);
  assert.equal(dreamContextText(d, "2026-10-29"), "");
});
