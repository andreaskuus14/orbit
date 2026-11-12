import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assetRefs, editCopy, parseBrief, renderSite, type Brief } from "../src/lib/site-brief-pure.ts";
import { puckEdits, toPuck, withBase } from "../src/lib/site-puck-pure.ts";

const brief = (n: string): Brief => { const p = parseBrief(JSON.parse(readFileSync(new URL(`./fixtures/site-w02/${n}`, import.meta.url), "utf8"))); if ("errors" in p) throw new Error(p.errors.join("; ")); return p.brief; };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

for (const n of ["brief-detailed.json", "brief-house.json"]) test(`${n}: a section edit in Puck exports through the existing renderer with images and scroll scripts untouched`, () => {
  const b = brief(n), d = toPuck(b);
  assert.deepEqual(puckEdits(b, d), { edits: [] });
  const sec = d.content.find((c) => c.props.body.length)!, e = clone(d), p = e.content.find((c) => c.props.id === sec.props.id)!.props;
  p.heading = "A new heading"; p.body[0].text = "New first paragraph.";
  const r = puckEdits(b, e);
  assert.ok("edits" in r);
  assert.deepEqual(r.edits.map((x) => `${x.section}.${x.field}`), [`${sec.props.id}.heading`, `${sec.props.id}.body.0`]);
  const ed = editCopy(b, r.edits);
  assert.ok("brief" in ed);
  const before = renderSite(b), after = renderSite(ed.brief);
  assert.match(after["index.html"].replace(/<[^>]+>/g, ""), /A new heading/); // immersive headings wrap words in spans
  assert.match(after["index.html"], /New first paragraph\./);
  assert.match(after["index.html"], /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.deepEqual(assetRefs(after["index.html"]), assetRefs(before["index.html"]));
  for (const f of Object.keys(before).filter((f) => /^(css|js)\//.test(f))) assert.equal(after[f], before[f], f);
  assert.deepEqual(puckEdits(b, d), { edits: [] }, "undo back to the loaded data is no edit");
});

test("structure changes are refused: the brief, not the editor, owns order, sections and lists", () => {
  const b = brief("brief-detailed.json"), d = toPuck(b);
  const moved = clone(d); moved.content.reverse();
  assert.ok("error" in puckEdits(b, moved));
  const grown = clone(d), withItems = grown.content.find((c) => c.props.items.length)!;
  withItems.props.items.push({ label: "", title: "x", body: "y" });
  assert.match((puckEdits(b, grown) as { error: string }).error, /not added or removed/);
});

test("editor preview loads relative pictures from the workspace link, leaves absolute and data URLs", () => {
  assert.equal(withBase(`<img src="img/a.jpg"><canvas data-path="seq/f%03d.jpg"></canvas><img src="https://x.test/b.png"><img src="data:image/png;base64,A"><a href="#t">`, "/w/k/"),
    `<img src="/w/k/img/a.jpg"><canvas data-path="/w/k/seq/f%03d.jpg"></canvas><img src="https://x.test/b.png"><img src="data:image/png;base64,A"><a href="#t">`);
});

test("editCopy refuses body.N past the last paragraph (no appending) but still edits existing ones", () => {
  const b = brief("brief-detailed.json"), sec = b.sections.find((s) => s.body.length)!;
  const bad = editCopy(b, [{ section: sec.id, field: `body.${sec.body.length}`, value: "x" }]);
  assert.ok("error" in bad);
  const ok = editCopy(b, [{ section: sec.id, field: `body.${sec.body.length - 1}`, value: "Last one." }]);
  assert.ok("brief" in ok && ok.brief.sections.find((s) => s.id === sec.id)!.body.at(-1) === "Last one." && ok.brief.sections.find((s) => s.id === sec.id)!.body.length === sec.body.length);
});
