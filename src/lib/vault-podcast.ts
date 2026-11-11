// VAULT podcast IO: reads the picked VAULT files (only those, never journal or LIFE content), has the model write a HOST/GUEST
// dialogue, then speaks it with the audio briefing's local Kokoro voices. One WAV per file set+versions is cached, so a replay is instant.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { askClaude } from "./claude";
import { kokoroTts } from "./clips/kokoro";
import { encodeWav } from "./local-ai-pure";
import { gapAfter, VOICES } from "./briefing-audio-pure";
import { cacheKey, MAX_FILES, parseDialogue, PODCAST_SYSTEM, sourceText } from "./vault-podcast-pure";
import { listVault, readVaultText, VaultError } from "./vault";

export async function vaultPodcast(names: unknown, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Array.isArray(names) || !names.length) throw new VaultError("Pick at least one file");
  const all = await listVault(), picked = all.filter((f) => names.includes(f.name)).slice(0, MAX_FILES);
  if (!picked.length) throw new VaultError("None of those files are in the vault", 404);
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  const file = path.join(process.env.ORBIT_DATA_DIR?.trim() || local, "vault-podcast", `${cacheKey(picked)}.wav`);
  try { return new Uint8Array(await readFile(file)); } catch { /* not made yet */ }
  const docs = await Promise.all(picked.map(async (f) => ({ name: f.name, text: (await readVaultText(f.name, 20000)) ?? "" })));
  const src = sourceText(docs);
  if (!src) throw new VaultError("Those files have no readable text yet");
  const { text } = await askClaude(src, PODCAST_SYSTEM, { purpose: "vault-podcast", signal });
  const lines = parseDialogue(text);
  if (lines.length < 2) throw new VaultError("The model did not return a usable script", 502);
  const tts = await kokoroTts(), parts: Float32Array[] = [];
  let rate = 24000;
  for (const [i, l] of lines.entries()) {
    const s = await tts.generate(l.text, { voice: VOICES[l.who] });
    rate = s.sampling_rate; parts.push(s.audio, new Float32Array(Math.round(gapAfter(l, lines[i + 1]) * rate)));
  }
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  const wav = encodeWav(out, rate);
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, wav);
  return wav;
}
