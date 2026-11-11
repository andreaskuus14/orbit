// The art director, disk and model side: 1-6 images in, a scored verdict and fixes out. One headless-Chromium pass downsizes each
// image for the model (long side ≤1568 px, JPEG) and measures its pixels; the critique runs on the local Claude CLI under the owner's
// own login (askClaude: no per-token bill, no paid image credits). Optional everywhere: callers treat an error as "no review".
// Rubric, parser and verdict: art-director-pure.ts.
import { readFile } from "node:fs/promises";
import { askClaude } from "./claude.ts";
import { prepare } from "./art-measure.ts";
import { ART_SYSTEM, artPrompt, artVerdict, measuredNotes, parseCritique, type ArtKind, type ArtReport } from "./art-director-pure.ts";

const MAX_IMAGES = 6, MAX_IN = 40 * 1024 * 1024; // full-page site screenshots can be large; they're downsized before the model sees them

/** Review 1-6 images (paths or bytes) as a site, a set of video frames or ARCH renders. One repair round for a vague critique. */
export async function artReview(inputs: (string | Uint8Array)[], kind: ArtKind, opts: { context?: string; signal?: AbortSignal } = {}): Promise<ArtReport | { error: string }> {
  if (!inputs.length || inputs.length > MAX_IMAGES) return { error: `give 1-${MAX_IMAGES} images` };
  const files = await Promise.all(inputs.map((x) => (typeof x === "string" ? readFile(x).then((b) => new Uint8Array(b)) : x))).catch(() => null);
  if (!files || files.some((f) => f.length > MAX_IN)) return { error: "couldn't read the images (missing or over 40 MB)" };
  const prep = await prepare(files);
  if ("error" in prep) return prep;
  const ask = (extra: string) => askClaude(artPrompt(kind, files.length, opts.context) + extra, ART_SYSTEM, { images: prep.images, purpose: "art director", signal: opts.signal });
  let parsed = parseCritique((await ask("")).text, kind);
  if ("errors" in parsed) parsed = parseCritique((await ask(`\nYour last critique was rejected: ${parsed.errors.slice(0, 8).join("; ")}. Redo it as the JSON object.`)).text, kind);
  if ("errors" in parsed) return { error: `the critique stayed too vague: ${parsed.errors.slice(0, 3).join("; ")}` };
  return artVerdict(parsed.critique, measuredNotes(prep.measures, kind), kind);
}
