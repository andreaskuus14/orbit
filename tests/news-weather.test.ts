import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  contours, fieldAt, forecast, fronts, independentOutlets, isobarLevels, kindOf, parseSnapshot, pressureField, shortTitle, shouldReplace,
  sinceLast, snapshotOf, stopAt, stops, storyCues, systems, tourPlan, weather, wrapLines, MAX_BEAMS, TOUR, frontType, highs, toHpa, fieldValue,
} from "../src/lib/news-weather-pure.ts";
import {
  arcFor, backView, chipRow, horizonFade, inDisk, overlaps, placeLabels, project, restScene, restView, slerp, stopScene, storyView, trail, STOP, PRESS,
  daylight, safeFrame, subsolar,
} from "../src/lib/news-weather-motion-pure.ts";
import { CTL0, frameAt, keyAction, nextClock } from "../src/lib/news-weather-tour-pure.ts";
import { WX_TEXT, tourLength } from "../src/lib/news-weather-text-pure.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/news-weather-22nov.json", import.meta.url), "utf8"));
const hs = fx.geo.hotspots;

test("storms need 5+ independent outlets; cells 1–4", () => {
  assert.equal(kindOf(5), "storm"); assert.equal(kindOf(4), "cell"); assert.equal(kindOf(1), "cell"); assert.equal(kindOf(0), null);
  const sys = systems(hs);
  const by = Object.fromEntries(sys.map((s) => [s.key, s]));
  assert.equal(by["United States of America"].kind, "storm");
  assert.equal(by.Indonesia.kind, "cell"); assert.equal(by.Indonesia.outlets, 3);
  assert.ok(sys.every((s, i) => i === 0 || sys[i - 1].outlets >= s.outlets), "biggest first");
});

test("the same outlet twice and syndicated copies count once", () => {
  const a = (id: string, source: string, title: string, t: string) => ({ id, url: `https://x/${id}`, title, source, published_at: t });
  const g = [a("1", "AP", "Quake hits coast", "2026-11-22T01:00:00Z"), a("2", "AP", "Quake hits coast again", "2026-11-22T02:00:00Z"), a("3", "BBC", "Quake hits coast", "2026-11-22T03:00:00Z")];
  const ind = independentOutlets(g);
  assert.ok(ind.length <= 2 && ind[0].id === "1");
});

test("fronts: two countries sharing one event, from where it was reported first, deduped", () => {
  const fr = fronts(hs);
  assert.ok(fr.length >= 2 && fr.length <= 3);
  assert.ok(fr.some((f) => [f.from, f.to].sort().join("|") === "Iran|United States of America"));
  const pairs = fr.map((f) => [f.from, f.to].sort().join("|"));
  assert.equal(new Set(pairs).size, pairs.length);
});

test("forecast line in English and Estonian", () => {
  const sys = systems(hs), fr = fronts(hs);
  assert.match(forecast(sys, fr), /^\d+ storms?, \d+ fronts?\. Calm over Africa and Oceania\.$/);
  assert.match(forecast(sys, fr, "et"), /tormi, \d+ fronti?\. Vaikne: Aafrika ja Okeaania\.$/);
  assert.equal(forecast([], []), "No storms today.");
});

test("stops follow the briefing, land on the right system, bright beam = fetched", () => {
  const sys = systems(hs);
  const st = stops(fx.briefing.content, fx.briefing.citations, sys);
  assert.equal(st[0].system.key, "Indonesia");
  assert.equal(st[0].headline, "Factory fire kills three, 36 missing");
  assert.ok(st[0].confirmed);
  assert.deepEqual(st[0].beams.filter((b) => b.fetched).map((b) => b.source), ["Al Jazeera"]);
  assert.ok(st.every((s) => s.beams.length <= MAX_BEAMS && s.lines.length <= 2));
  assert.ok(st.every((s) => s.beams.every((b, i) => i === 0 || !b.fetched || s.beams[i - 1].fetched)), "bright beams first");
});

test("a story the parser drops can't shift citations onto the next story", () => {
  const sys = systems(hs);
  const md = "## World\n### Empty story — Confirmed\n\n" + fx.briefing.content.replace("## World\n", "");
  const st = stops(md, fx.briefing.citations, sys);
  assert.equal(st[0].system.key, "Indonesia");
});

test("text helpers", () => {
  assert.equal(shortTitle("Iran blockade exit talks open in Oman - Reuters"), "Iran blockade exit talks open in Oman".slice(0, 34).replace(/ \S*$/, "") + "…");
  const w = wrapLines("one two three four five six seven eight nine ten eleven twelve", 20, 2);
  assert.equal(w.length, 2); assert.ok(w.every((l) => l.length <= 21)); assert.ok(w[1].endsWith("…"));
  assert.equal(tourLength(6, 70_000, "en"), "6 stories · 1 min 10 s");
  assert.deepEqual(Object.keys(WX_TEXT.en).sort(), Object.keys(WX_TEXT.et).sort());
});

test("isobars: gaussian field peaks on the hotspots, levels rise, contours are closed-ish lon/lat polylines", () => {
  const f = pressureField([{ lon: 0, lat: 0, reports: 100 }], 90, 45);
  const centre = fieldAt(f, 44, 22), far = fieldAt(f, 0, 22);
  assert.ok(centre > far * 10);
  const lv = isobarLevels(f.max);
  assert.ok(lv.every((v, i) => i === 0 || v > lv[i - 1]));
  const cs = contours(f, lv);
  assert.ok(cs.every((c) => c.lines.length >= 1));
  for (const c of cs) for (const l of c.lines) for (const [lon, lat] of l) assert.ok(lon >= -200 && lon <= 200 && lat >= -90 && lat <= 90);
  assert.ok(weather(hs, fx.briefing).isobars.length === 7);
});

test("voice cues: stories start in order inside the audio; the plan is 60–75 s without audio", () => {
  const cues = storyCues(fx.briefing.title, fx.briefing.content, 40_000);
  assert.equal(cues.length, 2); assert.ok(cues[0] > 0 && cues[0] < cues[1] && cues[1] < 40_000);
  const p = tourPlan(6);
  const total = p[p.length - 1].end;
  assert.ok(total >= TOUR.min && total <= TOUR.max, `total ${total}`);
  const withAudio = tourPlan(2, cues, 40_000);
  assert.equal(withAudio[0].start, 0); assert.equal(withAudio[1].start, Math.max(cues[1] - TOUR.lead, 3000)); assert.equal(withAudio[1].end, 40_000);
  assert.deepEqual(stopAt(p, 0), { i: 0, local: 0 });
  assert.equal(stopAt(p, total).i, 6);
});

test("since you last looked: grew, new front, weakened; snapshot kept 30 min", () => {
  const sys = systems(hs), fr = fronts(hs);
  const prev = snapshotOf(sys.map((s) => (s.key === "Iran" ? { ...s, outlets: 4 } : s.key === "Ukraine" ? { ...s, outlets: 9 } : s)), fr.slice(0, 1), 0);
  const ch = sinceLast(prev, sys, fr, 5);
  assert.ok(ch.some((c) => c.kind === "grew" && c.key === "Iran"));
  assert.ok(ch.some((c) => c.kind === "weakened" && c.key === "Ukraine"));
  assert.ok(ch.some((c) => c.kind === "front"));
  assert.deepEqual(sinceLast(null, sys, fr), []);
  assert.equal(parseSnapshot(JSON.stringify(prev))?.at, 0); assert.equal(parseSnapshot("{bad"), null); assert.equal(parseSnapshot('{"at":1}'), null);
  assert.ok(!shouldReplace(prev, 10 * 60_000)); assert.ok(shouldReplace(prev, 31 * 60_000)); assert.ok(shouldReplace(null, 0));
});

test("projection: front at z=1, edge at z=0, horizon fade", () => {
  const v = { lon: 10, lat: 20, scale: 100, cx: 0, cy: 0 };
  const c = project(v, 10, 20); assert.ok(Math.abs(c.x) < 1e-9 && Math.abs(c.z - 1) < 1e-9);
  assert.ok(project(v, -170, -20).z < 0);
  assert.equal(horizonFade(0), 0); assert.equal(horizonFade(1), 1);
  const [lon, lat] = slerp([0, 0], [90, 0], 0.5); assert.ok(Math.abs(lon - 45) < 1e-6 && Math.abs(lat) < 1e-6);
});

test("labels never overlap, stay in the disk and off blockers", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: String(i), ax: 300 + (i % 4) * 30, ay: 300 + Math.floor(i / 4) * 25, w: 150, h: 34, prio: i }));
  const blockers = [{ x: 250, y: 250, w: 40, h: 40 }];
  const out = placeLabels(items, blockers, (r) => inDisk(r, 320, 320, 260, 8));
  assert.ok(out.length > 0);
  for (const a of out) {
    assert.ok(inDisk(a, 320, 320, 260, 8));
    assert.ok(!blockers.some((b) => overlaps(a, b, 8)));
    for (const b of out) if (a !== b) assert.ok(!overlaps(a, b));
  }
  const chips = chipRow(3, [120, 140, 110], 900, 1000, 96);
  assert.ok(chips.every((c) => c.x >= 48 && c.x + c.w <= 952));
  assert.ok(chips.every((c, i) => i === 0 || c.x >= chips[i - 1].x + chips[i - 1].w));
});

test("acting: press dips then settles; HUD leaves staggered; fly has anticipation and a hold; beams then lower third", () => {
  const r0 = restScene(-1), rDown = restScene(PRESS.down), rLater = restScene(1500);
  assert.equal(r0.press, 1); assert.ok(rDown.press < 0.95); assert.ok(Math.abs(rLater.press - 1) < 1e-3);
  const mid = restScene(PRESS.hudOut + 200); assert.ok(mid.hud[0] < mid.hud[3], "stagger");
  const free = { x: 0, y: 0, w: 1280, h: 720 };
  const rest = restView(hs.map((h: { lon: number; lat: number; count: number }) => ({ lon: h.lon, lat: h.lat, reports: h.count })), free);
  const to = storyView({ lon: 106, lat: -6 }, free);
  const early = stopScene(STOP.flyDur * 0.06, rest, to, 3, 10_000);
  assert.ok(early.trailP <= 0, "anticipation: eases back first");
  assert.ok(Math.abs(stopScene(STOP.flyDur * 0.97, rest, to, 3, 10_000).view.lon - to.lon) < 1e-6); // hold at the end of the fly
  const s = stopScene(STOP.beams + 10, rest, to, 3, 10_000);
  assert.ok(s.beams[0] > 0 && s.beams[2] === 0 && s.lower[0] === 0);
  const s2 = stopScene(STOP.lower + 1500, rest, to, 3, 10_000);
  assert.ok(s2.lower.every((x) => x === 1) && s2.beams.every((x) => x === 1));
  assert.ok(arcFor(rest, to) > arcFor(to, { ...to, lon: to.lon + 5 }));
  const red = stopScene(10, rest, to, 3, 10_000, true);
  assert.equal(red.view.lon, to.lon); assert.equal(red.trailA, 0);
  assert.deepEqual(backView(to, rest, PRESS.back + 1), rest);
  assert.ok(trail([0, 0], [90, 0], 0.5).every((p) => p.u <= 0.5));
});

test("tour state machine and keys", () => {
  const free = { x: 0, y: 0, w: 1280, h: 720 };
  const w = weather(hs, fx.briefing);
  const rest = restView([{ lon: 0, lat: 20, reports: 10 }], free);
  const x = { rest, views: w.stops.map((s) => storyView(s.system, free)), stops: w.stops, plan: tourPlan(w.stops.length), reduced: false };
  assert.equal(frameAt(CTL0, 0, 0, x).i, -1);
  const tour = { ...CTL0, mode: "tour" as const, pressAt: 0 };
  assert.equal(frameAt(tour, 100, -160, x).i, -1);
  assert.equal(frameAt(tour, 5000, 4000, x).i, 0);
  assert.equal(frameAt(tour, 5000, x.plan[1].start + 10, x).i, 1);
  assert.ok(frameAt(tour, 5000, x.plan[1].end + 10, x).done);
  assert.equal(nextClock(x.plan, 10), x.plan[1].start);
  assert.equal(keyAction(" ", "tour"), "pause"); assert.equal(keyAction("ArrowRight", "tour"), "next"); assert.equal(keyAction("Escape", "tour"), "back");
  assert.equal(keyAction("Escape", "rest"), null);
});

test("fronts get chart symbols: occluded joins two storms, cold = confirmed, warm = still forming", () => {
  const sys = systems(hs), fr = fronts(hs);
  const by = Object.fromEntries(fr.map((f) => [f.key, frontType(f, sys)]));
  assert.equal(by["Iran>United States of America"], "occluded");
  assert.equal(by["Turkey>United Kingdom"], "warm");
  const cell = sys.find((s) => s.kind === "cell")!, storm = sys.find((s) => s.kind === "storm")!;
  assert.equal(frontType({ key: "x", title: "", from: storm.key, to: cell.key, outlets: 6, color: "" }, sys), "cold");
  assert.equal(frontType({ key: "x", title: "", from: storm.key, to: cell.key, outlets: 3, color: "" }, sys), "warm");
});

test("highs sit over the calm regions the forecast names", () => {
  const sys = systems(hs);
  assert.deepEqual(highs(sys).map((h) => h.region).sort(), ["Africa", "Oceania"]);
  assert.equal(highs([]).length, 6);
});

test("hPa numbers: quiet 1016, busiest 972, lower = busier; isobars and centres carry them", () => {
  assert.equal(toHpa(0, 10), 1016); assert.equal(toHpa(10, 10), 972); assert.equal(toHpa(20, 10), 972); assert.equal(toHpa(5, 0), 1016);
  const w = weather(hs, fx.briefing);
  assert.ok(w.isobars.every((l, i) => i === 0 || l.hpa < w.isobars[i - 1].hpa), "inner rings lower");
  for (const s of w.systems) assert.ok(w.hpa[s.key] >= 972 && w.hpa[s.key] <= 1016);
  const us = w.hpa["United States of America"], indo = w.hpa.Indonesia;
  assert.ok(us < indo, "the big storm is deeper than a small cell");
  assert.equal(w.hpa["H:Africa"] >= 1008, true);
  const pts = hs.map((h: { lon: number; lat: number; count: number }) => ({ lon: h.lon, lat: h.lat, reports: h.count }));
  assert.ok(Math.abs(fieldValue(pts, hs[0].lon, hs[0].lat) - fieldValue(pts, hs[0].lon + 0.01, hs[0].lat)) < 0.1);
});

test("forecast never says 0 storms", () => {
  const fr = fronts(hs), cells = systems(hs).filter((s) => s.kind === "cell");
  assert.match(forecast(cells, fr), /^No storms, \d+ fronts?\./);
  assert.match(forecast(cells, fr, "et"), /^Torme pole, \d+ fronti?\./);
  const storms = systems(hs).filter((s) => s.kind === "storm");
  assert.match(forecast(storms, []), /^\d+ storms?, no fronts\./);
});

test("sunlight: the subsolar point and a soft terminator", () => {
  const noon = subsolar(Date.UTC(2026, 5, 21, 12, 0));
  assert.ok(Math.abs(noon.lon) < 0.5 && noon.lat > 23 && noon.lat < 23.6, "June solstice noon: over Greenwich, near 23.4° N");
  const dec = subsolar(Date.UTC(2026, 11, 21, 0, 0));
  assert.ok(Math.abs(Math.abs(dec.lon) - 180) < 0.5 && dec.lat < -23, "December midnight UTC: over the dateline, south");
  assert.ok(Math.abs(subsolar(Date.UTC(2026, 10, 22, 8, 30)).lon - 52.5) < 0.01);
  assert.equal(daylight(noon, 0, 23.4), 1);
  assert.equal(daylight(noon, 180, -23.4), 0);
  const edge = daylight({ lon: 0, lat: 0 }, 90, 0);
  assert.ok(edge > 0.4 && edge < 0.6, "on the terminator: half lit");
});

test("free frame: the panel, the top bands and the bottom bands come off; nonsense samples fall back", () => {
  const W = 1280, H = 720, rows = 24, cols = 32, fb = { x: 0, y: 0, w: W, h: H };
  const rects = [{ x: 0, y: 0, w: W, h: 56 }, { x: 368, y: 68, w: 544, h: 44 }, { x: 340, y: 598, w: 600, h: 36 }, { x: 304, y: 648, w: 672, h: 56 }, { x: 768, y: 56, w: 512, h: 664 }];
  const grid = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => {
    const px = ((x + 0.5) / cols) * W, py = ((y + 0.5) / rows) * H;
    return rects.some((o) => px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h);
  }));
  const f = safeFrame(grid, W, H, fb);
  assert.equal(f.x, 0);
  assert.ok(f.x + f.w <= 768, "clear of the panel");
  assert.ok(f.y >= 112, "below the search box");
  assert.ok(f.y + f.h <= 598, "above the region chips and the command bar");
  for (const o of rects) assert.ok(!overlaps(f, o), `frame overlaps ${JSON.stringify(o)}`);
  assert.deepEqual(safeFrame(grid.map((r) => r.map(() => true)), W, H, fb), fb);
  assert.deepEqual(safeFrame(grid.map((r) => r.map(() => false)), W, H, fb), fb);
  assert.deepEqual(safeFrame([], W, H, fb), fb);
});

test("safe frame on a phone: top bars and a bottom sheet leave the band between them", async () => {
  const { safeFrame } = await import("../src/lib/news-weather-motion-pure.ts");
  const rows = 24, cols = 32, covered = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, () => y < 4 || y >= 13));
  const f = safeFrame(covered, 390, 844, { x: 0, y: 0, w: 390, h: 844 });
  assert.equal(f.x, 0); assert.equal(f.w, 390);
  assert.ok(f.y > 130 && f.y < 160 && f.y + f.h < 460 && f.h > 250, JSON.stringify(f));
});
