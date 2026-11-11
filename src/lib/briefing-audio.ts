// Audio briefing: speaks briefing-audio-pure's two-voice script with the local Kokoro voices (free, offline) and joins the lines
// into one WAV with short pauses. One file per briefing is kept under the data folder, so a replay is instant.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { kokoroTts } from "./clips/kokoro";
import { encodeWav } from "./local-ai-pure";
import { gapAfter, script, VOICES } from "./briefing-audio-pure";

export async function briefingAudio(b: { id: string; title: string; content: string; created_at: string }): Promise<Uint8Array> {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  const dir = process.env.ORBIT_DATA_DIR?.trim() || local; // ORBIT's data folder, as translate.ts
  const file = path.join(dir, "briefing-audio", `${b.id.replace(/[^\w-]/g, "")}.wav`);
  try { return new Uint8Array(await readFile(file)); } catch { /* not made yet */ }
  const when = new Date(b.created_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const lines = script(b.title, b.content, when), tts = await kokoroTts(), parts: Float32Array[] = [];
  let rate = 24000;
  for (const [i, l] of lines.entries()) {
    const s = await tts.generate(l.text, { voice: VOICES[l.who] });
    rate = s.sampling_rate; parts.push(s.audio, new Float32Array(Math.round(gapAfter(l, lines[i + 1]) * rate)));
  }
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  const wav = encodeWav(all, rate);
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, wav);
  return wav;
}
