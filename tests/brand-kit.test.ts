import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_KIT, DEFAULT_KIT_ID, assStyleColour, assTagColour, brandIssue, isDefaultKit, kitId, parseBrandKit, type BrandKit } from "../src/lib/brand-kit-pure.ts";
import { buildAss, thumbSvg } from "../src/lib/clips/pure.ts";
import { buildComposition } from "../src/lib/clips/hyperframes-pure.ts";
import { dialogueAss, thumbAss } from "../src/lib/clips/story-pure.ts";
import { publishWarnings } from "../src/lib/clips/publish-checks-pure.ts";
import { words } from "./brand-golden-cases.ts";

const kitOf = (p: object) => { const k = parseBrandKit(p); assert.ok(typeof k !== "string", String(k)); return k as BrandKit; };
const custom = kitOf({ caption: { font: "Impact", size: 120, text: "#eeeeee", highlight: "#00ff00", shout: "#0000ff", outline: "#222222", outlineWidth: 6, bottom: 500 },
  hook: { box: "#112233", text: "#ffff00" }, card: { intro: "Hi {there}", outro: "Follow for more" }, thumb: { accent: "#00aaff", text: "#fafafa" } });

test("defaults: empty or partial input keeps the defaults, and the default id is stable", () => {
  assert.deepEqual(parseBrandKit({}), DEFAULT_KIT);
  assert.deepEqual(parseBrandKit({ caption: { size: 100 } }), DEFAULT_KIT);
  assert.ok(isDefaultKit(DEFAULT_KIT) && !isDefaultKit(custom));
  assert.equal(kitId(DEFAULT_KIT), DEFAULT_KIT_ID);
  assert.notEqual(kitId(custom), DEFAULT_KIT_ID);
});

test("colour conversion for libass", () => {
  assert.equal(assStyleColour("#ff2e63"), "&H00632EFF");
  assert.equal(assTagColour("#ffe500"), "&H00E5FF&");
  assert.equal(assTagColour("#ffffff"), "&HFFFFFF&");
});

test("validation: bad values are refused with a sentence, good ones normalised", () => {
  for (const bad of [null, [], "x", { caption: "x" }, { caption: { size: 5 } }, { caption: { size: 100.5 } }, { caption: { size: "100" } }, { caption: { text: "red" } },
    { caption: { text: "#fff" } }, { caption: { font: "Arial,Bold" } }, { caption: { font: "a".repeat(41) } }, { caption: { font: "{\\b1}" } },
    { caption: { bottom: 5000 } }, { caption: { outlineWidth: -1 } }, { caption: { left: 700, right: 700 } }, { card: { intro: "x".repeat(41) } }, { card: { intro: 5 } }, { thumb: { accent: "#12345g" } }])
    assert.equal(typeof parseBrandKit(bad), "string", JSON.stringify(bad));
  const k = kitOf({ caption: { text: "#FFAA00", font: "  Open Sans " }, card: { intro: "<b>{hi}</b>\\\n there" } });
  assert.equal(k.caption.text, "#ffaa00"); assert.equal(k.caption.font, "Open Sans");
  assert.ok(!/[<>{}\\\n]/.test(k.card.intro)); // markup, ASS braces and backslashes never survive
});

test("a changed kit shows up in captions, hook card, thumbnail and drama subtitles", () => {
  const ass = buildAss({ hook: "Hook", words, duration: 10, kit: custom });
  assert.match(ass, /Style: Cap,Impact,120,&H00EEEEEE,&H00EEEEEE,&H00222222,&H80000000,-1,0,0,0,100,100,0,0,1,6,5,2,70,150,500,1/);
  assert.match(ass, /Style: Hook,Arial,92,&H0000FFFF,/);
  assert.ok(ass.includes("\\c&H00FF00&") && ass.includes("\\c&HFF0000&") && ass.includes("\\c&HEEEEEE&"));
  assert.ok(ass.includes("Style: Card,") && /Dialogue: 2,0:00:00.00,0:00:01.50,Card,,0,0,0,,HI THERE/.test(ass) && /Dialogue: 2,0:00:08.50,0:00:10.00,Card,,0,0,0,,FOLLOW FOR MORE/.test(ass));
  const html = buildComposition({ hook: "Hook", words, duration: 10, kit: custom })!;
  assert.ok(html.includes("bottom:500px") && html.includes("#00ff00") && html.includes("#0000ff") && html.includes("#112233") && html.includes('"Impact",Montserrat'));
  assert.ok(html.includes('class="card-in"') && html.includes("FOLLOW FOR MORE"));
  const svg = thumbSvg("Title here", 1080, 1920, 1, custom);
  assert.ok(svg.includes("#00aaff") && svg.includes("#fafafa") && !svg.includes("#ff2e63"));
  assert.match(dialogueAss([{ text: "x", start: 0, end: 1 }], "h", custom), /Style: Line,Impact,54,&H00EEEEEE/);
  assert.match(thumbAss("t", custom), /Style: T,Impact,110,&H00EEEEEE,&H00EEEEEE,&H00222222/);
});

test("cards alone still make an effects layer; no cards, no words = nothing", () => {
  assert.equal(buildComposition({ hook: "", words: [], duration: 5 }), null);
  assert.ok(buildComposition({ hook: "", words: [], duration: 5, kit: kitOf({ card: { outro: "bye" } }) })!.includes("BYE"));
});

test("matches-brand-kit check: a warning only, for clips rendered with another look", () => {
  assert.equal(brandIssue({ video: "a.mp4" }, DEFAULT_KIT), null); // pre-kit clip + untouched kit
  assert.equal(brandIssue({ video: "a.mp4", brand: kitId(custom) }, custom), null);
  assert.match(brandIssue({ video: "a.mp4" }, custom)!, /different caption and thumbnail look/); // old clip, kit edited since
  assert.match(brandIssue({ video: "a.mp4", brand: kitId(custom) }, DEFAULT_KIT)!, /different/);
  assert.equal(brandIssue({ brand: "zzz" }, custom), null); // nothing rendered yet
  assert.deepEqual(publishWarnings({ video: "a.mp4" }, DEFAULT_KIT), []);
  assert.equal(publishWarnings({ video: "a.mp4" }, custom).length, 1);
});
