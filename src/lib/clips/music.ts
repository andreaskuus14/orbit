// Music bed for a STUDIO video: ACE-Step when the owner set ORBIT_ACESTEP_CMD (cached per prompt), else a track from the music
// folder, else none. Rules and the command template: music-pure.ts.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { acestepArgv, musicPrompt } from "./music-pure";

export async function pickMusic(o: { idea: string; style: string; format?: string; seconds: number; dir: string; cache: string }): Promise<string | null> {
  const tpl = process.env.ORBIT_ACESTEP_CMD?.trim();
  if (tpl) {
    const prompt = musicPrompt(o), out = path.join(o.cache, `ace-${createHash("sha1").update(prompt + o.seconds).digest("hex").slice(0, 12)}.wav`);
    if (await stat(out).then((s) => s.size > 0, () => false)) return out;
    const argv = acestepArgv(tpl, { prompt, seconds: o.seconds + 4, out });
    if (argv) {
      await mkdir(o.cache, { recursive: true });
      const ok = await new Promise<boolean>((done) => execFile(argv[0], argv.slice(1), { timeout: 15 * 60_000, windowsHide: true }, (e) => done(!e)));
      if (ok && (await stat(out).then((s) => s.size > 0, () => false))) return out;
      console.warn("[studio] ACE-Step didn't produce music; using the music folder");
    } else console.warn("[studio] ORBIT_ACESTEP_CMD needs a command and {out}; using the music folder");
  }
  const files = await readdir(o.dir).then((n) => n.filter((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f)), () => [] as string[]);
  return files.length ? path.join(o.dir, files[Math.floor(Math.random() * files.length)]) : null;
}
