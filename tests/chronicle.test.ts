import { test } from "node:test";
import assert from "node:assert/strict";
import { arcPrompt, buildChronicle, dayLastYear, narrate, parseArcTitles, titleableMonths, BIG, type ChronIn } from "../src/lib/chronicle-pure.ts";
import type { LedgerEvent } from "../src/lib/ledger-pure.ts";

const NOW = Date.parse("2026-10-23T12:00:00Z"); // Fri 23 Oct 2026, Tallinn
const ev = (id: string, at: string, type: string, planet: string, data: object) => ({ id, at, type, planet, data }) as LedgerEvent;
const mem = (id: string, at: string, title: string, kind = "note", tags: string[] = [], source: string | null = null) => ({ id, title, kind, tags, source, created_at: at });
const BASE: ChronIn = {
  now: NOW,
  events: [
    ev("1", "2026-10-20T10:00:00Z", "goal.step", "agents", { goalId: "g1", step: "s1", status: "done", goalDone: true }),
    ev("2", "2026-10-21T12:00:00Z", "clip.outcome48h", "studio", { clipId: "j/c1", views: 12400, likes: 300 }),
    ev("3", "2026-10-22T09:00:00Z", "business.stage", "business", { prospect: "Cafe", to: "replied" }),
    ev("4", "2026-10-21T19:00:00Z", "journal.saved", "life", { memoryId: "jx" }),
    ev("5", "2026-10-22T18:00:00Z", "focus.session", "life", { minutes: 10 }), // too short to be a moment
    ev("6", "2026-10-22T03:00:00Z", "night.end", "agents", { night: "n1", done: 4, approvals: 1, failed: 0, calls: 3, minutes: 40 }),
  ],
  memories: [
    mem("m1", "2025-10-22T10:00:00Z", "First sketch of the villa", "idea", ["arch"]),
    mem("m2", "2026-10-19T10:00:00Z", "Call with CORE about pricing", "conversation", ["call"], "core-summary"),
    mem("j1", "2026-10-20T20:00:00Z", "SECRET journal words", "journal"),
  ],
  goals: [{ id: "g1", title: "Ship pet sim update", status: "done", updatedAt: "2026-10-20T10:00:00Z", steps: [{ id: "s1", what: "Publish" }] }],
  clips: [{ job: "j", id: "c1", title: "Pet sim hatch", publishedAt: "2026-10-19T16:00:00Z" }, { job: "j", id: "c2", title: "Draft" }],
  dev: [{ id: "d1", start: "2026-10-18T15:00:00Z", line: "Roblox dev · Session 1 · 40 min" }],
};

test("moments: kinds, planets, links; journal left out by default", () => {
  const c = buildChronicle(BASE);
  const by = (id: string) => c.moments.find((m) => m.id === id)!;
  assert.equal(by("m:m1").kind, "arch"); assert.equal(by("m:m1").planet, "arch");
  assert.equal(by("m:m2").kind, "call");
  assert.equal(by("e:1").kind, "goal-done"); assert.deepEqual(by("e:1").links, [{ id: "goal:g1", kind: "week:goal", title: "Ship pet sim update" }]);
  assert.equal(by("c:j/c1").planet, "studio");
  assert.ok(!c.moments.some((m) => m.kind === "journal" || m.title.includes("SECRET")));
  assert.ok(!c.moments.some((m) => m.id === "e:5"));
  assert.ok(!c.moments.some((m) => m.id === "c:j/c2"), "unpublished clips are not moments");
  assert.equal(c.from, "2025-10-22"); assert.equal(c.to, "2026-10-23");
  assert.equal(c.days.length, 367);
  for (let i = 1; i < c.moments.length; i++) assert.ok(c.moments[i - 1].at <= c.moments[i].at);
});

test("firsts become beacons", () => {
  const c = buildChronicle(BASE);
  const by = (id: string) => c.moments.find((m) => m.id === id)!;
  assert.equal(by("e:2").first, "First Short over 10k views"); assert.equal(by("e:2").score, 1);
  assert.equal(by("e:3").first, "First client reply"); assert.ok(by("e:3").score >= BIG);
  assert.equal(by("c:j/c1").first, "First Short out");
  assert.equal(by("d:d1").first, "First Roblox dev session");
});

test("arcs: Monday weeks with deterministic titles, model titles override", () => {
  const c = buildChronicle(BASE);
  const wk = c.arcs.find((a) => a.week === "2026-10-19")!;
  assert.equal(wk.to, "2026-10-25");
  assert.equal(wk.title, "The week of the first Short over 10k views");
  assert.ok(wk.auto);
  assert.equal(c.arcs.find((a) => a.week === "2026-08-03")!.title, "A quiet week");
  const t = buildChronicle(BASE, { "2026-10-19": "The week the pet-sim update shipped" });
  assert.equal(t.arcs.find((a) => a.week === "2026-10-19")!.title, "The week the pet-sim update shipped");
});

test("private: included only on request, never in the arc prompt or narration", () => {
  const c = buildChronicle({ ...BASE, includePrivate: true });
  const j = c.moments.filter((m) => m.kind === "journal");
  assert.equal(j.length, 2); // the memory and the journal.saved event without a matching row
  assert.ok(j.every((m) => m.private && m.title === "Journal entry" && !m.links.length));
  const p = arcPrompt(c, "2026-10");
  assert.ok(!p.includes("Journal") && !p.includes("SECRET"));
  assert.ok(p.includes("Ship pet sim update"));
  assert.ok(!narrate(c, 0, c.days.length).some((n) => n.text.includes("Journal")));
  assert.ok(c.arcs.every((a) => a.top.every((id) => !c.moments.find((m) => m.id === id)!.private)));
});

test("streaks: 3+ consecutive days", () => {
  const days = ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-15", "2026-10-21", "2026-10-22", "2026-10-23"];
  const c = buildChronicle({ ...BASE, clips: days.map((d, i) => ({ job: "s", id: `x${i}`, title: `S${i}`, publishedAt: `${d}T10:00:00Z` })) });
  const s = c.streaks.filter((x) => x.what === "Shorts out");
  assert.deepEqual(s.map((x) => [x.from, x.to, x.days]), [["2026-10-09", "2026-10-12", 4], ["2026-10-21", "2026-10-23", 3]]);
});

test("this day last year, narration, titleable months, title parsing", () => {
  const c = buildChronicle(BASE);
  assert.deepEqual(dayLastYear(c, "2026-10-23").map((m) => m.id), ["m:m1"]);
  assert.deepEqual(dayLastYear(c, "2026-06-01"), []);
  const n = narrate(c, c.days.length - 7, c.days.length - 1);
  assert.equal(n[0].text, "First Roblox dev session. Roblox dev · Session 1 · 40 min.");
  assert.equal(n[1].text, "The week of the first Short over 10k views.");
  assert.ok(n.some((x) => x.text.startsWith("First Short over 10k views. 12,400 views")));
  assert.deepEqual(titleableMonths(c, NOW, []), ["2025-10"]); // October 2026 isn't finished yet
  assert.deepEqual(titleableMonths(c, NOW, ["2025-10"]), []);
  assert.deepEqual(parseArcTitles('ok {"2026-10-19": "The week the pet-sim update shipped", "1999-01-01": "x", "2026-10-26": 5}', ["2026-10-19", "2026-10-26"]), { "2026-10-19": "The week the pet-sim update shipped" });
  assert.deepEqual(parseArcTitles("no json", ["2026-10-19"]), {});
});
