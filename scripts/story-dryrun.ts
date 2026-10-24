// AI Story dry run: the whole pipeline with the fake Higgsfield (no network, no credits) → a real MP4.
//   node --experimental-strip-types scripts/story-dryrun.ts <out dir> [--silent]
// Narration: local Kokoro (downloads ~90 MB once), or silence with --silent. Captions: the script timings (no Whisper here).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fakeHiggsfield } from "../src/lib/clips/higgsfield.ts";
import { makeStory } from "../src/lib/clips/story-render.ts";
import { parseDuration } from "../src/lib/clips/pure.ts";
import { approveProblem, fingerprint, parseStory, quoteTotal, storyItems, type StoryJob, type StoryOpts } from "../src/lib/clips/story-pure.ts";

const dir = path.resolve(process.argv[2] ?? "story-dryrun");
const silent = process.argv.includes("--silent");
mkdirSync(dir, { recursive: true });
const ff = process.env.ORBIT_FFMPEG || "ffmpeg";

const reply = JSON.stringify({ title: "The Lighthouse Letter", hook: "The letter was dated tomorrow", scenes: [
  { visual: "An old lighthouse keeper with a grey beard and a yellow raincoat opens a wet envelope at night, storm outside", narration: "Every night for forty years, Elias kept the light burning. Tonight, a letter washed up at his door.", sec: 7, camera: "slow push in" },
  { visual: "Close-up of the letter in the keeper's shaking hands, his own handwriting, dated tomorrow", narration: "It was in his own handwriting. And it was dated tomorrow.", sec: 6, camera: "pan right" },
  { visual: "The keeper climbs the spiral stairs of the lighthouse holding a lantern, shadows on the walls", narration: "It said one thing: do not light the lamp at midnight.", sec: 6, camera: "tilt up" },
  { visual: "From the lighthouse gallery the keeper sees a ship's lights heading straight at the rocks", narration: "At midnight, a ship appeared, heading straight for the rocks.", sec: 6, camera: "pull out" },
  { visual: "The keeper's hand hovers over the lamp switch, storm light on his face, torn between choices", narration: "Every instinct told him to light it. He didn't.", sec: 6, camera: "slow push in" },
  { visual: "Dawn, calm sea, the keeper on the beach finds a second envelope in the sand, his handwriting again", narration: "At dawn the ship was safe in the harbor. And on the sand lay another letter. Dated tomorrow.", sec: 9, camera: "pull out" },
] });

const opts: StoryOpts = { idea: "lighthouse keeper gets a letter from his future self", style: "moody cinematic painting", length: 45, voice: silent ? "none" : "kokoro:af_heart", motion: "stills" };
const story = parseStory(reply, opts.length);
if (typeof story === "string") throw new Error(story);
const now = new Date().toISOString();
const job: StoryJob = { v: 1, id: "dryrun-000000", createdAt: now, updatedAt: now, status: "draft", step: "", opts, story, items: storyItems(story, opts, { image: "gpt_image_2_5", video: "seedance_2_5", audio: "seed_audio" }), warnings: [] };

const hf = fakeHiggsfield(), signal = new AbortController().signal;
const q = await hf.quote(job.items, signal);
if ("error" in q) throw new Error(q.error.message);
job.items.forEach((i) => (i.credits = q.ok.credits[i.key]));
job.quote = { total: quoteTotal(job.items), balance: q.ok.balance, plan: q.ok.plan, fingerprint: fingerprint(story, opts), at: now };
console.log(`quote: ${job.quote.total} credits (fake), approve check: ${approveProblem(job, job.quote.total) || "ok"}`);

const run = (args: string[], cwd: string, okCodes = [0]) => new Promise<string>((res, rej) => {
  const c = spawn(ff, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  c.stderr.on("data", (d) => (err += d));
  c.on("close", (code) => (okCodes.includes(code ?? -1) ? res(err) : rej(new Error(err.slice(-600)))));
});
type Tts = Promise<{ generate(t: string, o: { voice: string }): Promise<{ save(f: string): Promise<void> }> }>;
let kokoro: Tts | undefined;
const t0 = Date.now();
const out = await makeStory(job, dir, {
  hf, pollMs: 0,
  ffmpeg: (args, cwd) => run(args, cwd),
  duration: async (f) => parseDuration(await run(["-hide_banner", "-i", f], dir, [1])) ?? 0,
  tts: silent ? undefined : async (text, voice, file) => {
    kokoro ??= import("kokoro-js").then((m) => m.KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" })) as unknown as Tts;
    await (await (await kokoro!).generate(text, { voice })).save(file);
  },
  save: async (step) => console.log(" ·", step),
}, signal);
console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s: ${path.join(dir, out.video)} (${out.duration} s)${out.thumb ? `, thumb ${path.join(dir, out.thumb)}` : ""}`);
if (job.warnings.length) console.log("warnings:", job.warnings);
