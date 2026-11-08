// Scene renderer (W03): renders each manifest scene to its own MP4 (stickman frames piped to ffmpeg, fake voice, burned caption),
// caches it by input hash, then joins the scenes into the final file. Only scenes whose hash changed are rendered again.
// Pure logic: scene-manifest-pure.ts and stickman-pure.ts. Driver: scripts/scene-film.ts.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assemblyHash, cues, fakeVoiceWav, layout, sceneAss, sceneHashes, envelope, starts, stageToPx, wordSpans, FPS, type Format, type Manifest, type Probe, type Scene } from "./scene-manifest-pure.ts";
import { disk, drawRig, hex, image, rect, rig, sample } from "./stickman-pure.ts";

export type Built = { id: string; version: number; inputHash: string; outputHash: string; file: string; reused: boolean; ms: number };
export type Film = { format: Format; scenes: Built[]; final: { file: string; inputHash: string; outputHash: string; reused: boolean; ms: number } };

const exists = (f: string) => stat(f).then(() => true, () => false);
export const fileHash = async (f: string) => createHash("sha256").update(await readFile(f)).digest("hex");
// Same inputs → same bytes: no encoder/version tags, fixed x264 settings.
const EXACT = ["-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1"];
const X264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"];

function run(bin: string, args: string[], cwd: string, feed?: (w: NodeJS.WritableStream) => Promise<void>): Promise<string> {
  return new Promise((ok, no) => {
    const p = spawn(bin, args, { cwd, stdio: [feed ? "pipe" : "ignore", "pipe", "pipe"] });
    let err = "", out = "";
    p.stdout!.on("data", (d) => (out += d)); p.stderr!.on("data", (d) => (err = (err + d).slice(-8000)));
    p.on("error", no);
    p.on("close", (c) => (c === 0 ? ok(out + err) : no(new Error(`${path.basename(bin)} exited ${c}: ${err.slice(-1500)}`))));
    if (feed) feed(p.stdin!).then(() => p.stdin!.end(), (e) => { p.kill(); no(e); });
  });
}

/** One scene → MP4 (h264 + AAC), exactly scene.frames frames and frames/FPS seconds of audio. */
async function renderScene(m: Manifest, s: Scene, i: number, format: Format, scale: number, ff: string, work: string, out: string) {
  const L = layout(format, scale), [w, h] = L.size, ch = m.assets[s.character];
  const { to, k } = stageToPx(s, format, scale), bg = hex(s.bg), ink = hex(ch.color);
  const base = image(w, h, bg);
  for (const p of s.props) {
    if (p.kind === "rect") { const a = to([p.x0, p.y0]), b = to([p.x1, p.y1]); rect(base, a[0], a[1], b[0], b[1], hex(p.color)); }
    else { const c = to([p.cx, p.cy]); disk(base, c[0], c[1], p.r * k, hex(p.color)); }
  }
  const tag = `${s.id}-${format}`, wav = path.join(work, `${tag}.wav`), ass = `${tag}.ass`;
  const cue = cues(m, format).find((c) => c.scene === s.id), at0 = starts(m)[i];
  await writeFile(wav, s.audio.kind === "fake-tts" ? fakeVoiceWav(s.line, s.audio.at, s.frames, s.audio.voice) : fakeVoiceWav("", 0, s.frames, "none"));
  await writeFile(path.join(work, ass), sceneAss(cue, at0, format, scale), "utf8");
  const spans = wordSpans(s.line), at = s.audio.kind === "fake-tts" ? s.audio.at : 0;
  const tmp = `${out}.part.mp4`;
  await run(ff, ["-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${w}x${h}`, "-r", String(FPS), "-i", "-", "-i", wav,
    "-filter_complex", `[0:v]ass=${ass},format=yuv420p[v];[1:a]aformat=channel_layouts=stereo,aresample=48000[a]`, "-map", "[v]", "-map", "[a]",
    "-frames:v", String(s.frames), ...X264, ...EXACT, tmp], work, async (stdin) => {
    for (let f = 0; f < s.frames; f++) {
      const img = { w, h, px: base.px.slice() };
      const mouth = s.audio.kind === "fake-tts" ? envelope(spans, (f - at) / FPS) : 0;
      drawRig(img, rig(sample(s.acting, f), s.home, s.face, ch.headR), to, k, ch.line, ink, bg, mouth);
      if (!stdin.write(img.px)) await new Promise((r) => stdin.once("drain", r));
    }
  });
  await rename(tmp, out);
}

/** Builds one format: reuses cached scenes whose input hash is unchanged, renders the rest, then joins (cached by the scene outputs). */
export async function buildFilm(m: Manifest, format: Format, o: { ffmpeg: string; cache: string; out: string; scale?: number }): Promise<Film> {
  const scale = o.scale ?? 1, dir = path.join(o.cache, format), work = path.join(dir, "work");
  await mkdir(work, { recursive: true }); await mkdir(o.out, { recursive: true });
  const hashes = sceneHashes(m, format, scale), scenes: Built[] = [];
  for (const [i, s] of m.scenes.entries()) {
    const t = Date.now(), file = path.join(dir, `scene-${hashes[s.id]}.mp4`), reused = await exists(file);
    if (!reused) await renderScene(m, s, i, format, scale, o.ffmpeg, work, file);
    scenes.push({ id: s.id, version: s.version, inputHash: hashes[s.id], outputHash: await fileHash(file), file, reused, ms: Date.now() - t });
  }
  const t = Date.now(), inputHash = assemblyHash(format, scenes.map((s) => s.outputHash)), cached = path.join(dir, `final-${inputHash}.mp4`), reused = await exists(cached);
  if (!reused) {
    const n = scenes.length, inputs = scenes.flatMap((s) => ["-i", s.file]);
    // Cut each scene back to its exact frames and samples: AAC padding would otherwise push every later cut late by a frame.
    const trims = m.scenes.map((s, i) => `[${i}:v]trim=end_frame=${s.frames},setpts=PTS-STARTPTS[v${i}];[${i}:a]atrim=end_sample=${(s.frames * 48000) / FPS},asetpts=N/SR/TB[a${i}]`);
    await run(o.ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", `${trims.join(";")};${m.scenes.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[v][a]`,
      "-map", "[v]", "-map", "[a]", "-frames:v", String(m.scenes.reduce((a, s) => a + s.frames, 0)), ...X264, ...EXACT, "-movflags", "+faststart", `${cached}.part.mp4`], dir);
    await rename(`${cached}.part.mp4`, cached);
  }
  const file = path.join(o.out, `film-${format}.mp4`);
  await copyFile(cached, file);
  return { format, scenes, final: { file, inputHash, outputHash: await fileHash(cached), reused, ms: Date.now() - t } };
}

/** ffprobe + volumedetect of a finished file (inputs for preflight). */
export async function probe(file: string, ffmpeg: string, ffprobe: string): Promise<Probe> {
  const j = JSON.parse(await run(ffprobe, ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", file], path.dirname(file)).then((s) => s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)));
  const v = j.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const vol = await run(ffmpeg, ["-hide_banner", "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], path.dirname(file));
  const db = (k: string) => { const x = new RegExp(`${k}_volume: (-?[\\d.]+) dB`).exec(vol); return x ? Number(x[1]) : null; };
  return { duration: Number(j.format.duration), width: v?.width ?? 0, height: v?.height ?? 0, fps: v?.r_frame_rate ?? "", frames: Number(v?.nb_read_frames ?? 0),
    audioStreams: j.streams.filter((s: { codec_type: string }) => s.codec_type === "audio").length, meanDb: db("mean"), maxDb: db("max") };
}
