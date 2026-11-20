// Fixture renders for the brand-kit golden test: the same inputs run through buildAss / buildComposition / thumbSvg / renderArgs.
// tests/fixtures/brand-golden.json was generated from the code BEFORE the brand kit existed (git show of the first commit on this branch).
import { buildAss, renderArgs, thumbLayout, thumbSvg, type Word } from "../src/lib/clips/pure.ts";
import { buildComposition } from "../src/lib/clips/hyperframes-pure.ts";

export const words: Word[] = [
  { start: 0.2, end: 0.5, text: "this" }, { start: 0.5, end: 0.9, text: "is" }, { start: 0.9, end: 1.3, text: "insane." },
  { start: 2, end: 2.4, text: "NO", loud: true }, { start: 2.4, end: 2.8, text: "way" }, { start: 3, end: 3.3, text: "WHAT", loud: true },
  { start: 3.4, end: 3.9, text: "extraordinarily" }, { start: 3.9, end: 4.4, text: "unbelievable" }, { start: 6, end: 6.5, text: "<b>{x}\\y</b>", loud: true },
  { start: 7, end: 7.4, text: "Tom" }, { start: 7.4, end: 7.8, text: "&" }, { start: 7.8, end: 8.2, text: "Jerry's" },
];
const pb = { n: 5, payoffAt: 0.5, effects: [{ label: "emoji", n: 5 }, { label: "text pop-up", n: 5 }] };
const segs = [{ start: 0, end: 4 }, { start: 5, end: 9 }];

export function goldenCases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const style of ["karaoke", "classic", undefined] as const) {
    out[`ass-${style ?? "default"}`] = buildAss({ hook: "Watch THIS {now}", words, duration: 9, style });
    out[`ass-${style ?? "default"}-nohook`] = buildAss({ hook: " ", words, duration: 5, style });
    out[`hf-${style ?? "default"}`] = buildComposition({ hook: "Watch this & that", words, duration: 9, style, playbook: pb })!;
  }
  out["ass-empty"] = buildAss({ hook: "", words: [], duration: 3 });
  out["hf-hookonly"] = buildComposition({ hook: "Just a hook", words: [], duration: 3 })!;
  for (const t of ["Why nobody talks about this", "A", "The most unbelievable extraordinary thing ever seen on camera today"]) {
    out[`thumb-${t.slice(0, 12)}`] = thumbSvg(t);
    out[`thumb-${t.slice(0, 12)}-0.85`] = thumbSvg(t, 1080, 1920, 0.85);
    out[`thumbLayout-${t.slice(0, 12)}`] = JSON.stringify(thumbLayout(t));
  }
  out["thumb-16x9"] = thumbSvg("Wide one", 1280, 720);
  out["args-ass"] = JSON.stringify(renderArgs({ input: "src.mp4", start: 1, duration: 9, segs, audio: true, layout: "split", zooms: [1, 3.5], ass: "c.ass", out: "out.mp4" }));
  out["args-fit"] = JSON.stringify(renderArgs({ input: "src.mp4", start: 1, duration: 9, audio: true, layout: "fit", ass: "c.ass", out: "out.mp4", progressBar: true, fadeOut: true, encoder: "nvenc" }));
  out["args-noass"] = JSON.stringify(renderArgs({ input: "src.mp4", start: 1, duration: 9, audio: false, layout: "fill", out: "out.mp4" }));
  return out;
}
