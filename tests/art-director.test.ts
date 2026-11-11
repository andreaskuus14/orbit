import { test } from "node:test";
import assert from "node:assert/strict";
import { artMarkdown, artPrompt, artVerdict, criteriaFor, measuredNotes, parseCritique, type Measure } from "../src/lib/art-director-pure.ts";

const good = (id: string, score = 4) => ({ id, score, evidence: `the ${id} element in the upper left third reads clearly against the dusk sky`, fix: `keep the ${id} as is and darken the lower band slightly` });
const full = (kind: "site" | "frames" | "render", score = 4) => JSON.stringify({ criteria: criteriaFor(kind).map((c) => good(c.id, score)), strongest: "the dusk light on the facade", biggest_gap: "type sits on top instead of in the scene" });

test("rubric: sites get hierarchy and type, renders don't; every kind gets focal, light and craft", () => {
  const site = criteriaFor("site").map((c) => c.id), render = criteriaFor("render").map((c) => c.id);
  assert.ok(site.includes("hierarchy") && site.includes("type"));
  assert.ok(!render.includes("type") && !render.includes("hierarchy"));
  for (const k of ["site", "frames", "render"] as const) for (const id of ["focal", "light", "craft"]) assert.ok(criteriaFor(k).some((c) => c.id === id), `${k} ${id}`);
  assert.match(artPrompt("render", 2), /focal \(Focal point\)/);
});

test("parser: accepts a specific critique, tolerates fences and chatter", () => {
  const r = parseCritique("Here you go:\n```json\n" + full("render") + "\n```", "render");
  assert.ok("critique" in r, JSON.stringify(r));
  assert.equal(r.critique.criteria.length, criteriaFor("render").length);
});

test("parser: rejects vague evidence, non-actions, bad scores and missing criteria, and says which", () => {
  const ids = criteriaFor("render").map((c) => c.id);
  const bad = { criteria: [
    { id: ids[0], score: 4, evidence: "Overall it looks good.", fix: "keep it" },
    { id: ids[1], score: 3, evidence: "the jetty in the lower right leads the eye into the frame nicely", fix: "Consider improving the composition." },
    { id: ids[2], score: 7, evidence: "the window glow at centre is warm against the blue hour sky", fix: "lift the shadows under the eaves by a stop" },
  ] };
  const r = parseCritique(JSON.stringify(bad), "render");
  assert.ok("errors" in r);
  const e = r.errors.join("\n");
  assert.match(e, new RegExp(`${ids[0]}: evidence is vague`));
  assert.match(e, new RegExp(`${ids[1]}: fix must start with a concrete action`));
  assert.match(e, new RegExp(`${ids[2]}: score must be a whole number`));
  assert.match(e, new RegExp(`${ids[3]}: missing`));
  assert.ok("errors" in parseCritique("not json", "site"));
});

test("verdict: computed from scores, not the model; any 1 or a hard pixel fact means redo", () => {
  const ok = parseCritique(full("site", 5), "site");
  assert.ok("critique" in ok);
  const ship = artVerdict(ok.critique, [], "site");
  assert.equal(ship.verdict, "ship"); assert.equal(ship.score, 100); assert.equal(ship.fixes.length, 0);
  const one = { ...ok.critique, criteria: ok.critique.criteria.map((c) => (c.id === "craft" ? { ...c, score: 1 } : c)) };
  assert.equal(artVerdict(one, [], "site").verdict, "redo");
  assert.match(artVerdict(one, [], "site").fixes[0], /^Craft and originality \(1\/5\)/, "worst criterion first");
  assert.equal(artVerdict(ok.critique, [{ note: "flat", hard: true }], "site").verdict, "redo");
  assert.equal(artVerdict(ok.critique, [{ note: "busy palette", hard: false }], "site").verdict, "revise");
  const mid = parseCritique(full("site", 3), "site");
  assert.ok("critique" in mid);
  assert.equal(artVerdict(mid.critique, [], "site").verdict, "revise", "all 3s = 50/100 → revise");
});

test("measured facts: flat grey, clipped, busy, empty centre and too small are caught; a healthy frame is quiet", () => {
  const ok: Measure = { w: 1920, h: 1080, lum: 0.45, spread: 0.22, colours: 18, centre: 0.3, clipped: 0.02 };
  assert.deepEqual(measuredNotes([ok], "render"), []);
  const notes = measuredNotes([{ ...ok, spread: 0.03 }, { ...ok, clipped: 0.6 }, { ...ok, colours: 80, centre: 0.05 }, { ...ok, w: 640, h: 360 }], "frames").map((n) => n.note).join("\n");
  for (const re of [/Image 1: almost no tonal contrast/, /Image 2: 60 % of pixels/, /Image 3: 80 competing colour groups/, /Image 3: the detail sits at the edges/, /Image 4: only 640×360/]) assert.match(notes, re);
  assert.ok(measuredNotes([{ ...ok, spread: 0.03 }], "render")[0].hard);
  assert.match(measuredNotes([{ ...ok, lum: 0.1 }, { ...ok, lum: 0.8 }], "frames").map((n) => n.note).join(), /brightness jumps/);
  assert.deepEqual(measuredNotes([{ ...ok, colours: 80, centre: 0.05, w: 400, h: 300, clipped: 0.3 }], "site"), [], "busy palettes, off-centre detail and white/black page areas are normal on a site (the W02 demo measured 26-29 % clipped)");
});

test("markdown report: verdict, table and numbered fixes", () => {
  const p = parseCritique(full("render", 3), "render");
  assert.ok("critique" in p);
  const md = artMarkdown(artVerdict(p.critique, [], "render"));
  assert.match(md, /^## Art direction: REVISE \(50\/100\)/);
  assert.match(md, /\| Focal point \| 3\/5 \|/);
  assert.match(md, /^1\. /m);
});

test("pixel pass in real Chromium: a flat grey image is flagged hard, a lit scene isn't; output is a downsized JPEG", async (t) => {
  const { prepare } = await import("../src/lib/art-measure.ts");
  const { launch } = await import("../src/lib/workspace-check.ts");
  const b = await launch();
  if (!b) return t.skip("no headless browser here");
  const page = await b.newPage({ viewport: { width: 2400, height: 1350 } });
  await page.setContent(`<body style="margin:0;background:#808080"></body>`);
  const grey = new Uint8Array(await page.screenshot({ type: "png" }));
  await page.setContent(`<body style="margin:0;background:linear-gradient(#0b1a2e,#e9a35a)"><div style="position:absolute;left:900px;top:450px;width:600px;height:450px;background:#1a120c"><div style="margin:120px;width:120px;height:90px;background:#ffd38a"></div></div></body>`);
  const lit = new Uint8Array(await page.screenshot({ type: "png" }));
  await b.close();
  const r = await prepare([grey, lit]);
  assert.ok(!("error" in r), JSON.stringify(r));
  assert.equal(r.images[0].type, "image/jpeg");
  assert.equal(r.measures[0].w, 2400, "measures report the original size");
  const notes = measuredNotes(r.measures, "render");
  assert.ok(notes.some((n) => n.hard && /Image 1: almost no tonal contrast/.test(n.note)), JSON.stringify(notes));
  assert.ok(!notes.some((n) => /Image 2/.test(n.note)), JSON.stringify(notes));
  assert.ok("error" in (await prepare([new TextEncoder().encode("not an image")])));
});

test("parser accepts the real fixes the vision model wrote on the W02 demo (recorded 2026-11-10)", () => {
  const real: Record<string, string> = {
    light: "Set the page background to the deep navy (#0b1d33) so the dusk grade continues past the image edges instead of ending against white.",
    palette: "Restrict UI colours to the art's palette: navy background, cream (#f3e3c3) text, and amber (#f0b76a) for links and the primary button; remove default blue.",
    legibility: "Change the caption colour to at least #595959 on white, or cream on navy, and raise body text to 18px.",
    consistency: "Add breakpoints so the hero scales to the viewport at each width, with the tower kept in the crop (object-position: 65% center).",
  };
  const j = { criteria: criteriaFor("site").map((c) => ({ ...good(c.id), ...(real[c.id] ? { fix: real[c.id] } : {}) })) };
  const r = parseCritique(JSON.stringify(j), "site");
  assert.ok("critique" in r, JSON.stringify(r));
  for (const weak of ["Consider a darker sky.", "Try to make the headline bigger and bolder", "Improve the composition of the hero area"]) {
    const k = { criteria: criteriaFor("site").map((c) => ({ ...good(c.id), ...(c.id === "focal" ? { fix: weak } : {}) })) };
    assert.ok("errors" in parseCritique(JSON.stringify(k), "site"), weak);
  }
});
