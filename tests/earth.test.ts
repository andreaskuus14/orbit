import { test } from "node:test";
import assert from "node:assert/strict";
import { band, distKm, introPath, lat2y, levelAt, lon2x, nearYou, pathMs, placesIn, poseAt, SHOTS, terrarium, tilesFor, townNews, upstreamTile, validTile, y2lat, x2lon, lerpPose, arcPoints } from "../src/lib/earth-pure.ts";

test("tile maths round-trips and covers a box", () => {
  assert.ok(Math.abs(y2lat(lat2y(59.437, 12), 12) - 59.437) < 1e-9);
  assert.ok(Math.abs(x2lon(lon2x(24.75, 12), 12) - 24.75) < 1e-9);
  const t = tilesFor({ w: 21.7, s: 57.5, e: 28.3, n: 59.7 }, 7);
  assert.ok(t.nx >= 3 && t.ny >= 2 && t.box.w <= 21.7 && t.box.n >= 59.7 && t.box.e >= 28.3 && t.box.s <= 57.5);
});

test("only real tiles and only the CC BY 2016 imagery", () => {
  assert.ok(validTile("day", 7, 72, 36));
  assert.ok(!validTile("day", 7, 128, 0));
  assert.ok(!validTile("night", 9, 0, 0));
  assert.ok(!validTile("x", 1, 0, 0));
  assert.ok(upstreamTile("day", 7, 72, 36).includes("s2cloudless_3857/default/g/7/36/72"));
  assert.ok(!/s2cloudless-20/.test(upstreamTile("day", 3, 1, 1)));
  assert.equal(terrarium(128, 0, 0), 0);
});

test("camera path: orbit → Estonia → Tallinn, smooth and continuous", () => {
  const p = introPath(), total = pathMs(p);
  assert.ok(total >= 10_000 && total <= 15_000, `path ${total} ms`);
  assert.equal(poseAt(p, 0).shot, "orbit");
  assert.equal(poseAt(p, total).shot, "town");
  let prev = poseAt(p, 0).pose;
  for (let t = 40; t <= total; t += 40) {
    const q = poseAt(p, t).pose;
    assert.ok(Math.abs(Math.log(q.alt / prev.alt)) < 0.2, `altitude jump at ${t}`);
    assert.ok(distKm(prev, q) < 200, `ground jump at ${t}`);
    prev = q;
  }
  const mid = lerpPose(SHOTS.orbit, SHOTS.country, 0.5);
  assert.ok(mid.alt < SHOTS.orbit.alt && mid.alt > SHOTS.country.alt);
  assert.equal(levelAt(16000), "orbit");
  assert.equal(levelAt(9), "town");
  assert.ok(band(100, 40, 400) > 0.9 && band(5, 40, 400) === 0);
});

test("arcs start and end on the ground and lift in the middle", () => {
  const a = arcPoints({ lon: 24.7, lat: 59.4 }, { lon: -77, lat: 38.9 });
  assert.ok(Math.abs(Math.hypot(...a[0]) - 1) < 1e-6 && Math.abs(Math.hypot(...a.at(-1)!) - 1) < 1e-6);
  assert.ok(Math.hypot(...a[24]) > 1.05);
});

test("geocoder finds Estonian places with case endings and skips common words", () => {
  const n = (s: string) => placesIn(s).map((p) => p.name);
  assert.deepEqual(n("Tallinnas avati uus sild"), ["Tallinn"]);
  assert.deepEqual(n("Tartust Pärnusse sõidab uus rong"), ["Tartu", "Pärnu"]);
  assert.deepEqual(n("Lasnamäel süttis maja"), ["Lasnamäe"]);
  assert.deepEqual(n("Tapa mind, ütles ta"), []);
  assert.deepEqual(n("Rong jõudis Tapale hilinemisega"), ["Tapa"]);
  assert.deepEqual(n("Pärnumaa uudised"), []); // a county is not the town
});

test("town news pins stories, falls back to the feed's home, and ranks", () => {
  const t = townNews([
    { title: "Tartus avati raamatukogu", url: "u1", source: "ERR", published_at: "2026-11-23T10:00:00Z" },
    { title: "Tartus avati raamatukogu", url: "u2", source: "Postimees", published_at: "2026-11-23T10:05:00Z" },
    { title: "Kontsert kultuurimajas", url: "u3", source: "Sakala", published_at: "2026-11-23T09:00:00Z", feedHome: "Viljandi" },
    { title: "Narvas ja Tartus sajab lund", url: "u4", source: "ERR", published_at: "2026-11-23T08:00:00Z" },
  ]);
  assert.equal(t[0].name, "Tartu");
  assert.equal(t[0].count, 2);
  assert.ok(t.find((x) => x.name === "Viljandi")!.stories[0].weak);
  const near = nearYou(t, { lon: 26.7, lat: 58.38 }, 100);
  assert.equal(near[0].name, "Tartu");
  assert.ok(near.every((x) => x.km <= 100));
});

test("earth data: rings by outlets, arcs only between known countries, timeline in order", async () => {
  const { earthData } = await import("../src/lib/earth-data-pure.ts");
  const st = (t: string, src: string, h: number) => ({ title: t, url: `https://${src}.com/${encodeURIComponent(t)}`, source: src, published_at: new Date(Date.now() - h * 3600_000).toISOString() });
  const d = earthData([
    { name: "Estonia", lat: 58.6, lon: 25, count: 2, stories: [st("Estonia and Finland sign power cable deal", "err", 3), st("Estonia and Finland sign power cable deal", "yle", 2)] },
    { name: "Finland", lat: 64, lon: 26, count: 1, stories: [st("Estonia and Finland sign power cable deal", "hs", 1)] },
  ], []);
  assert.ok(d.rings.length >= 1);
  assert.ok(d.timeline.length >= 1);
  for (let i = 1; i < d.timeline.length; i++) assert.ok(d.timeline[i - 1].time <= d.timeline[i].time);
});
