import { test } from "node:test";
import assert from "node:assert/strict";
import { areaOf, emptyRadar, findWindows, mentions, parseRadar, pingsDue, projectTerms, radarDay, safeUrl, stepFor, visibleWindows, windowCard, PING_MAX_PER_DAY, type Project, type Signal } from "../src/lib/radar-pure.ts";

const H = 3_600_000;
const NOW = Date.parse("2026-11-22T12:00:00Z"); // 14:00 Tallinn
const studio: Project = { area: "studio", name: "Your Shorts", terms: projectTerms("", ["what if"]) };
const game: Project = { area: "gamedev", name: "Pet simulator", terms: projectTerms("Pet simulator") };
const yt = (k: string, title: string, agoH: number, strong = false): Signal => ({ source: "youtube", key: k, title, at: NOW - agoH * H, url: `https://www.youtube.com/watch?v=${k.padEnd(11, "x")}`, strong });

test("mentions: whole words, plural allowed", () => {
  assert.ok(mentions("What If the Moon Vanished?", "what if"));
  assert.ok(mentions("Top pet simulators", "pet simulator"));
  assert.ok(!mentions("Whatif", "what if"));
  assert.ok(!mentions("carpet tricks", "pet"));
});

test("projectTerms / areaOf", () => {
  assert.deepEqual(projectTerms("Pet simulator"), ["pet simulator", "simulator"]);
  assert.equal(areaOf("Roblox pet simulator"), "gamedev");
  assert.equal(areaOf("Get 3 webshop clients"), "business");
  assert.equal(areaOf("What if videos"), "studio");
});

test("a window opens on 3 outliers in 48 h that fit a project, with reason, evidence and a draft step", () => {
  const sig = [yt("a", "What if Earth had rings", 3), yt("b", "What if the sun went out", 10), { source: "outlier" as const, key: "c", title: "What if no military", at: NOW - 20 * H }];
  const [w] = findWindows(sig, [studio], NOW);
  assert.ok(w);
  assert.equal(w.term, "what if");
  assert.equal(w.count, 3);
  assert.match(w.reason, /"what if" is spiking: 2 rising videos, 1 outlier in 48 h/);
  assert.equal(w.evidence.length, 3);
  assert.ok("agent" in w.step && w.step.agent === "forge" && /Draft only: do not publish/.test(w.step.request));
  assert.equal(w.closesAt, NOW - 3 * H + 48 * H);
});

test("no window: too few, not rising, off-topic or the wrong source for the area", () => {
  assert.deepEqual(findWindows([yt("a", "What if x", 1), yt("b", "What if y", 2)], [studio], NOW), [], "2 plain signals from one source");
  const busyBefore = [yt("a", "What if a", 1), yt("b", "What if b", 2), yt("c", "What if c", 3), yt("d", "What if d", 50), yt("e", "What if e", 60), yt("f", "What if f", 70)];
  assert.deepEqual(findWindows(busyBefore, [studio], NOW), [], "as busy the 48 h before: not opening");
  assert.deepEqual(findWindows([yt("a", "Cooking", 1), yt("b", "Cooking 2", 2), yt("c", "Cooking 3", 3)], [studio], NOW), []);
  const biz: Signal[] = [1, 2, 3].map((i) => ({ source: "business", key: `p${i}`, title: "what if", at: NOW - i * H, area: "business" }));
  assert.deepEqual(findWindows(biz, [studio], NOW), [], "leads don't fit STUDIO");
  assert.deepEqual(findWindows([yt("a", "What if", 49), yt("b", "What if", 50), yt("c", "What if", 51)], [studio], NOW), [], "older than 48 h");
});

test("2 signals open a window when one is strong or they come from two sources; longer term wins over its words", () => {
  const sig: Signal[] = [{ source: "roblox", key: "1", title: "Pet Simulator 99", at: NOW - H, strong: true, area: "gamedev", url: "https://www.roblox.com/games/1" },
    { source: "roblox", key: "2", title: "Pet Simulator X", at: NOW - 2 * H, area: "gamedev" }];
  const ws = findWindows(sig, [game], NOW);
  assert.equal(ws.length, 1);
  assert.equal(ws[0].term, "pet simulator");
  assert.equal(ws[0].step.label, "Plan a game update");
});

test("business windows open BUSINESS instead of drafting (names never go to a model)", () => {
  assert.deepEqual(stepFor("business", "hair salon", []), { label: "Open BUSINESS", open: "#o=business" });
});

test("ping caps: per day, per topic gap, quiet hours and Stop-all use nothing up", () => {
  const mk = (term: string, n: number): Signal[] => Array.from({ length: n }, (_, i) => yt(`${term}${i}`, `${term} clip ${i}`, i + 1));
  const projects: Project[] = ["alpha beta", "gamma delta", "epsilon zeta"].map((t) => ({ area: "studio", name: t, terms: [t] }));
  const ws = findWindows([...mk("alpha beta", 4), ...mk("gamma delta", 4), ...mk("epsilon zeta", 4)], projects, NOW);
  assert.equal(ws.length, 3);
  const q = pingsDue(ws, emptyRadar(), NOW, { quiet: true, stopAll: false });
  assert.deepEqual(q.ping, []);
  assert.equal(q.state.sent, 0);
  assert.deepEqual(pingsDue(ws, emptyRadar(), NOW, { quiet: false, stopAll: true }).ping, []);
  const a = pingsDue(ws, emptyRadar(), NOW, { quiet: false, stopAll: false });
  assert.equal(a.ping.length, PING_MAX_PER_DAY);
  const b = pingsDue(ws, a.state, NOW + H, { quiet: false, stopAll: false });
  assert.deepEqual(b.ping, [], "daily cap reached");
  const nextDay = NOW + 24 * H;
  const c = pingsDue(ws, b.state, nextDay, { quiet: false, stopAll: false });
  assert.deepEqual(c.ping.map((w) => w.id), [ws[2].id], "new day: only the topic not pinged in the last 3 days");
  assert.equal(c.state.sent, 1);
  assert.equal(radarDay(NOW), "2026-11-22");
});

test("acted and snoozed windows are hidden and never pinged", () => {
  const ws = findWindows([yt("a", "What if a", 1), yt("b", "What if b", 2), yt("c", "What if c", 3)], [studio], NOW);
  const s = { ...emptyRadar(), acted: { [ws[0].id]: NOW } };
  assert.deepEqual(visibleWindows(ws, s, NOW), []);
  assert.deepEqual(pingsDue(ws, s, NOW, { quiet: false, stopAll: false }).ping, []);
  const z = { ...emptyRadar(), snoozed: { [ws[0].id]: NOW - 8 * 24 * H } };
  assert.equal(visibleWindows(ws, z, NOW).length, 1, "a week's snooze runs out");
  assert.deepEqual(parseRadar("{bad"), emptyRadar());
  assert.equal(parseRadar(JSON.stringify({ v: 1, day: "x", sent: 1, pinged: { a: 1, b: "no" }, acted: {}, snoozed: {} })).pinged.b, undefined);
});

test("windowCard: shared card, needs him, one localized button; safeUrl only https", () => {
  const [w] = findWindows([yt("a", "What if a", 1), yt("b", "What if b", 2), yt("c", "What if c", 3)], [studio], NOW);
  const c = windowCard(w, "et", NOW);
  assert.equal(c.phase, "needs");
  assert.equal(c.action?.label, "Tee Shorti mustand");
  assert.match(c.result!.text, /umbes 47 h veel/);
  assert.equal(safeUrl("javascript:alert(1)"), undefined);
  assert.equal(safeUrl("http://x.example"), undefined);
  assert.equal(safeUrl("https://x.example/a"), "https://x.example/a");
});
